import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../../src/session/store.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nunnun-session-'))
  dirs.push(dir)
  return join(dir, name)
}

describe('SessionStore', () => {
  it('roundtrips appended events across reopen', () => {
    const path = tempFile('s1.jsonl')
    const a = SessionStore.open(path)
    const u1 = a.append('user/message', { text: 'hi' })
    const a1 = a.append('assistant/message', { text: 'hello' })

    const b = SessionStore.open(path)
    expect(b.events().map((e) => [e.seq, e.type])).toEqual([
      [u1.seq, 'user/message'],
      [a1.seq, 'assistant/message'],
    ])
    // seq continuity across reopen
    const next = b.append('user/message', { text: 'again' })
    expect(next.seq).toBe(a1.seq + 1)
  })

  it('derives model-visible messages from the log', () => {
    const path = tempFile('s2.jsonl')
    const s = SessionStore.open(path)
    s.append('user/message', { text: 'hi' })
    s.append('assistant/message', {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        api: 'openai-completions',
        provider: 'faux',
        model: 'test',
        usage: { input: 1, output: 1, totalTokens: 2 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    })
    s.append('tool/call', { callId: 'c1', toolName: 'bash', input: { command: 'echo hi' } })
    s.append('tool/result', { callId: 'c1', toolName: 'bash', output: 'hi\n', isError: false })

    const msgs = s.deriveMessages()
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toMatchObject({ role: 'user' })
    expect(msgs[1]).toMatchObject({ role: 'assistant' })
    expect(msgs[2]).toMatchObject({ role: 'toolResult', toolCallId: 'c1', isError: false })
  })

  it('torn tail: trailing partial line is ignored, prior events load', () => {
    const path = tempFile('s3.jsonl')
    writeFileSync(path, '{"seq":0,"ts":1,"type":"user/message","data":{"text":"a"}}\n{"seq":1,"ts":2,"type":"user/me')

    const s = SessionStore.open(path)
    expect(s.events()).toHaveLength(1)
    expect(s.events()[0]?.data).toEqual({ text: 'a' })
  })

  it('torn tail: appending after recovery keeps the log clean (no merged lines)', () => {
    const path = tempFile('s3b.jsonl')
    writeFileSync(path, '{"seq":0,"ts":1,"type":"user/message","data":{"text":"a"}}\n{"seq":1,"ts":2,"type":"user/me')

    const s = SessionStore.open(path) // recovery: torn tail removed from disk
    s.append('user/message', { text: 'b' })

    const reopened = SessionStore.open(path) // must not throw "corrupt session log"
    expect(reopened.events()).toHaveLength(2)
    expect(reopened.events()[1]?.data).toEqual({ text: 'b' })
  })

  it('compaction: events before firstKeptEventSeq are dropped from derived history, summary prepended', () => {
    const path = tempFile('s4.jsonl')
    const s = SessionStore.open(path)
    s.append('user/message', { text: 'old question' })
    s.append('assistant/message', {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'old answer' }],
        api: 'openai-completions',
        provider: 'faux',
        model: 'test',
        usage: { input: 1, output: 1, totalTokens: 2 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    })
    s.append('compaction', { summary: 'The user asked X and got Y.', firstKeptEventSeq: 2 })
    s.append('user/message', { text: 'new question' })

    const msgs = s.deriveMessages()
    expect(msgs).toHaveLength(2)
    expect(JSON.stringify(msgs[0])).toContain('The user asked X and got Y.')
    expect(msgs[1]).toMatchObject({ role: 'user' })
    expect(JSON.stringify(msgs)).not.toContain('old question')
  })

  it('tolerates an empty file', () => {
    const path = tempFile('s5.jsonl')
    writeFileSync(path, '')
    const s = SessionStore.open(path)
    expect(s.events()).toEqual([])
    const e = s.append('user/message', { text: 'first' })
    expect(e.seq).toBe(0)
  })

  it('creates missing parent directories on open (Review Focus: first run on a fresh machine)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-session-'))
    dirs.push(dir)
    const path = join(dir, 'sessions', 'nested', 'chat.jsonl') // parent dirs do not exist
    const s = SessionStore.open(path)
    const e = s.append('user/message', { text: 'first run' })
    expect(e.seq).toBe(0)
    expect(SessionStore.open(path).events()).toHaveLength(1)
  })
})
