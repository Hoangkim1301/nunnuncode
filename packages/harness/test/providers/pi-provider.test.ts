import { afterAll, describe, expect, it } from 'vitest'
import {
  registerFauxProvider,
  type FauxProviderRegistration,
} from '@earendil-works/pi-ai/compat'
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai'
import { createPiProvider } from '../../src/providers/pi-provider.ts'
import type { StreamEvent } from '../../src/providers/types.ts'

const registrations: FauxProviderRegistration[] = []
afterAll(() => {
  for (const r of registrations) r.unregister()
})

function makeFaux(tokensPerSecond?: number) {
  const r = registerFauxProvider({ api: 'faux-harness', tokensPerSecond })
  registrations.push(r)
  return r
}

function userMsg(text: string) {
  return { role: 'user' as const, content: [{ type: 'text' as const, text }] }
}

async function collect(provider: ReturnType<typeof createPiProvider>, req: Parameters<typeof provider.stream>[0]) {
  const events: StreamEvent[] = []
  for await (const ev of provider.stream(req)) events.push(ev)
  return events
}

describe('ModelProvider seam over pi-ai', () => {
  it('streams text deltas and terminates with done', async () => {
    const faux = makeFaux()
    faux.setResponses([fauxAssistantMessage('hello world')])
    const provider = createPiProvider({ model: faux.getModel() })

    const events = await collect(provider, { system: 'sys', messages: [userMsg('hi')], tools: [] })

    const text = events
      .filter((e): e is { type: 'text-delta'; delta: string } => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    expect(text).toBe('hello world')
    expect(events.at(-1)?.type).toBe('done')
  })

  it('maps thinking blocks to thinking-delta events', async () => {
    const faux = makeFaux()
    faux.setResponses([fauxAssistantMessage([fauxThinking('pondering'), fauxText('answer')])])
    const provider = createPiProvider({ model: faux.getModel() })

    const events = await collect(provider, { system: 'sys', messages: [userMsg('hi')], tools: [] })

    const thinking = events
      .filter((e): e is { type: 'thinking-delta'; delta: string } => e.type === 'thinking-delta')
      .map((e) => e.delta)
      .join('')
    expect(thinking).toBe('pondering')
  })

  it('emits one tool-call event per completed tool call', async () => {
    const faux = makeFaux()
    faux.setResponses([
      fauxAssistantMessage([fauxText('running'), fauxToolCall('bash', { command: 'echo hi' }, { id: 'call1' })]),
    ])
    const provider = createPiProvider({ model: faux.getModel() })

    const events = await collect(provider, { system: 'sys', messages: [userMsg('hi')], tools: [] })

    const calls = events.filter((e): e is { type: 'tool-call'; toolName: string; input: unknown; callId: string } => e.type === 'tool-call')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ toolName: 'bash', callId: 'call1', input: { command: 'echo hi' } })
  })

  it('aborts mid-stream: the generator ends instead of hanging', async () => {
    const faux = makeFaux(20) // fast enough to finish quickly, slow enough to abort mid-stream
    faux.setResponses([fauxAssistantMessage('x'.repeat(500))])
    const provider = createPiProvider({ model: faux.getModel() })

    const controller = new AbortController()
    const req = { system: 'sys', messages: [userMsg('hi')], tools: [], signal: controller.signal }

    let deltas = 0
    let lastEvent = ''
    for await (const ev of provider.stream(req)) {
      lastEvent = ev.type
      if (ev.type === 'text-delta') deltas++
      if (deltas === 2) controller.abort()
    }
    expect(deltas).toBeGreaterThanOrEqual(2)
    expect(lastEvent).toBe('error') // aborted streams end with the error event, not done
  })

  it('forwards retry options to pi-ai (retry behavior owned by pi-ai)', async () => {
    const faux = makeFaux()
    faux.setResponses([fauxAssistantMessage('ok')])
    const provider = createPiProvider({ model: faux.getModel(), retries: { maxAttempts: 2, maxRetryDelayMs: 1000 } })

    const events = await collect(provider, { system: 'sys', messages: [userMsg('hi')], tools: [] })
    expect(events.at(-1)?.type).toBe('done')
  })
})
