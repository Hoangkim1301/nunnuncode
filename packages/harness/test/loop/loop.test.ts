import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentLoop, type LiveEvent } from '../../src/loop/loop.ts'
import type { ModelProvider, StreamEvent } from '../../src/providers/types.ts'
import type { SessionEvent } from '../../src/session/events.ts'
import { SessionStore } from '../../src/session/store.ts'
import { compose, type HarnessContext, type Tool } from '../../src/runtime/composer.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function newSession(): SessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'nunnun-loop-'))
  dirs.push(dir)
  return SessionStore.open(join(dir, 'session.jsonl'))
}

/** Scripted ModelProvider: returns canned event sequences per stream call. */
class MockProvider implements ModelProvider {
  #scripts: StreamEvent[][] = []
  setScripts(...scripts: StreamEvent[][]): void {
    this.#scripts = scripts
  }
  async *stream(): AsyncIterable<StreamEvent> {
    const next = this.#scripts.shift()
    if (!next) throw new Error('mock provider: no script for this call')
    for (const ev of next) {
      if (ev.type === 'tool-call' || ev.type === 'text-delta' || ev.type === 'thinking-delta') yield ev
      else if (ev.type === 'done') yield ev
      else yield ev
    }
  }
}

const echoTool: Tool = {
  name: 'echo',
  description: 'echoes input',
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: async (input) => ({ output: `echo:${(input as { text: string }).text}` }),
}

function boot(session: SessionStore, provider: ModelProvider, tools: Tool[] = []) {
  const ctx: HarnessContext = compose(
    tools.map((tool) => ({ name: `p-${tool.name}`, setup: (c) => c.registerTool(tool) })),
    {},
  )
  return { loop: new AgentLoop(ctx, session, provider, 'You are a test assistant.'), ctx, session }
}

async function drain(loop: AgentLoop, input: string): Promise<LiveEvent[]> {
  const events: LiveEvent[] = []
  for await (const ev of loop.run(input)) events.push(ev)
  return events
}

const done = { type: 'done' as const, stopReason: 'stop' }

describe('AgentLoop', () => {
  it('one-step turn: streams text, appends user + assistant messages, no tools', async () => {
    const provider = new MockProvider()
    provider.setScripts([{ type: 'text-delta', delta: 'hello ' }, { type: 'text-delta', delta: 'world' }, done])
    const session = newSession()
    const { loop } = boot(session, provider)

    const events = await drain(loop, 'hi')

    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as { delta: string }).delta).join('')).toBe('hello world')
    const types = session.events().map((e) => e.type)
    expect(types).toEqual(['user/message', 'assistant/message'])
  })

  it('multi-step turn: tool call executes, result is appended, next step sees it', async () => {
    const provider = new MockProvider()
    provider.setScripts(
      [
        { type: 'text-delta', delta: 'running' },
        { type: 'tool-call', callId: 'c1', toolName: 'echo', input: { text: 'x' } },
        done,
      ],
      [{ type: 'text-delta', delta: 'result was echo:x' }, done],
    )
    const session = newSession()
    const { loop } = boot(session, provider, [echoTool])

    const events = await drain(loop, 'use the tool')

    const toolEnd = events.find((e) => e.type === 'tool-end') as { output?: string } | undefined
    expect(toolEnd?.output).toBe('echo:x')
    const types = session.events().map((e) => e.type)
    expect(types).toEqual(['user/message', 'assistant/message', 'tool/call', 'tool/result', 'assistant/message'])

    // derived history carries the toolResult between the two assistant messages
    const derived = session.deriveMessages()
    expect(derived).toHaveLength(4)
    expect(derived[2]).toMatchObject({ role: 'toolResult', toolCallId: 'c1' })
  })

  it('malformed tool call: reported as tool error, turn continues', async () => {
    const provider = new MockProvider()
    provider.setScripts(
      [
        { type: 'tool-call', callId: 'bad', toolName: 'no_such_tool', input: {} },
        done,
      ],
      [{ type: 'text-delta', delta: 'recovered' }, done],
    )
    const session = newSession()
    const { loop } = boot(session, provider, [echoTool])

    const events = await drain(loop, 'go')

    const end = events.find((e) => e.type === 'tool-end') as { isError?: boolean } | undefined
    expect(end?.isError).toBe(true)
    expect(session.events().at(-1)?.type).toBe('assistant/message')
    expect(JSON.stringify(session.events().at(-1))).toContain('recovered')
  })

  it('abort mid-stream: generator ends, no dangling tool/call in the log', async () => {
    const provider = new MockProvider()
    // script: a single delta, then the stream ends without a done event
    provider.setScripts([{ type: 'text-delta', delta: 'long stream' }])
    const session = newSession()
    const { loop } = boot(session, provider)

    const controller = new AbortController()
    const it_ = loop.run('hi', controller.signal)[Symbol.asyncIterator]()
    const first = await it_.next()
    expect(first.done).toBe(false)
    controller.abort()
    const second = await it_.next()
    expect(second.done).toBe(true)
    // no tool/call event logged (no tools called before abort)
    expect(session.events().map((e) => e.type)).not.toContain('tool/call')
  })
})
