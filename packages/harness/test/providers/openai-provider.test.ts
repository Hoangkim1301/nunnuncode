import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createOpenAICompatibleProvider } from '../../src/providers/openai-provider.ts'
import type { ModelDefinition, StreamEvent } from '../../src/providers/types.ts'

/**
 * Tests run against a real HTTP server emitting real SSE — so they exercise
 * the actual parsing, not a stub.
 */
interface Recorded {
  requests: Array<Record<string, unknown>>
}

const servers: Server[] = []
const recorded: Recorded = { requests: [] }

async function startServer(handler: (req: { body: unknown; res: import('node:http').ServerResponse; count: number }) => void): Promise<string> {
  recorded.requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body: unknown = undefined
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
      recorded.requests.push(body as Record<string, unknown>)
      handler({ body, res, count: recorded.requests.length })
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${port}/v1`
}

afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})
afterAll(() => {
  for (const s of servers.splice(0)) s.close()
})

function model(baseUrl: string): ModelDefinition {
  return { id: 'test-model', baseUrl, apiKey: 'test-key', contextWindow: 128_000, maxTokens: 8192, reasoning: true }
}

function sse(res: import('node:http').ServerResponse, chunks: object[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function delta(content: object): object {
  return { choices: [{ index: 0, delta: content, finish_reason: null }] }
}

async function collect(provider: ReturnType<typeof createOpenAICompatibleProvider>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const ev of provider.stream({
    system: 'you are a test',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() }],
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
  })) {
    events.push(ev)
  }
  return events
}

describe('OpenAI-compatible provider', () => {
  it('sends the system prompt, tools and messages in wire format', async () => {
    const baseUrl = await startServer(({ res }) => sse(res, [delta({ content: 'ok' }), { choices: [{ finish_reason: 'stop' }] }]))
    await collect(createOpenAICompatibleProvider(model(baseUrl)))

    const body = recorded.requests[0] as { messages: Array<Record<string, unknown>>; tools: Array<{ type: string; function: { name: string } }> }
    expect(body.messages[0]).toMatchObject({ role: 'system', content: 'you are a test' })
    expect(body.messages[1]).toMatchObject({ role: 'user' })
    expect(body.tools[0]).toMatchObject({ type: 'function', function: { name: 'bash' } })
  })

  it('streams text deltas and terminates with done', async () => {
    const baseUrl = await startServer(({ res }) =>
      sse(res, [delta({ content: 'hello ' }), delta({ content: 'world' }), { choices: [{ finish_reason: 'stop' }] }]),
    )
    const events = await collect(createOpenAICompatibleProvider(model(baseUrl)))

    const text = events.filter((e) => e.type === 'text-delta').map((e) => (e as { delta: string }).delta).join('')
    expect(text).toBe('hello world')
    expect(events.at(-1)?.type).toBe('done')
  })

  it('maps reasoning_content to thinking deltas', async () => {
    const baseUrl = await startServer(({ res }) =>
      sse(res, [delta({ reasoning_content: 'pondering' }), delta({ content: 'answer' }), { choices: [{ finish_reason: 'stop' }] }]),
    )
    const events = await collect(createOpenAICompatibleProvider(model(baseUrl)))
    const thinking = events.filter((e) => e.type === 'thinking-delta').map((e) => (e as { delta: string }).delta).join('')
    expect(thinking).toBe('pondering')
  })

  it('assembles split tool-call argument deltas into one call', async () => {
    const baseUrl = await startServer(({ res }) =>
      sse(res, [
        delta({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"comm' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] }),
        { choices: [{ finish_reason: 'tool_calls' }] },
      ]),
    )
    const events = await collect(createOpenAICompatibleProvider(model(baseUrl)))
    const calls = events.filter((e) => e.type === 'tool-call') as Array<{ callId: string; toolName: string; input: unknown }>
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ callId: 'call_1', toolName: 'bash', input: { command: 'ls' } })
  })

  it('maps tool_calls finish reason to toolUse and captures usage when present', async () => {
    const baseUrl = await startServer(({ res }) =>
      sse(res, [
        delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{}' } }] }),
        { choices: [{ finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ]),
    )
    const events = await collect(createOpenAICompatibleProvider(model(baseUrl)))
    const done = events.at(-1) as { type: string; stopReason?: string; usage?: { totalTokens: number } }
    expect(done.type).toBe('done')
    expect(done.stopReason).toBe('toolUse')
    expect(done.usage?.totalTokens).toBe(15)
  })

  it('retries 429/5xx with backoff, then succeeds', async () => {
    const baseUrl = await startServer(({ res, count }) => {
      if (count <= 2) {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      sse(res, [delta({ content: 'finally' }), { choices: [{ finish_reason: 'stop' }] }])
    })
    const provider = createOpenAICompatibleProvider(model(baseUrl), { maxAttempts: 3, maxRetryDelayMs: 10 })
    const events = await collect(provider)
    expect(recorded.requests).toHaveLength(3)
    expect(events.some((e) => e.type === 'text-delta')).toBe(true)
  })

  it('does not retry auth errors — surfaces them immediately', async () => {
    const baseUrl = await startServer(({ res }) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid key' } }))
    })
    const events = await collect(createOpenAICompatibleProvider(model(baseUrl)))
    expect(recorded.requests).toHaveLength(1)
    const err = events.find((e) => e.type === 'error') as { error: string } | undefined
    expect(String(err?.error)).toContain('401')
  })

  it('abort mid-stream ends the generator without hanging', async () => {
    const baseUrl = await startServer(({ res }) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(delta({ content: 'first' }))}\n\n`)
      // keep the stream open — the client must abort
    })
    const provider = createOpenAICompatibleProvider(model(baseUrl))
    const controller = new AbortController()
    let count = 0
    const started = Date.now()
    for await (const _ev of provider.stream({
      system: 's',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      tools: [],
      signal: controller.signal,
    })) {
      count++
      if (count === 1) controller.abort()
    }
    expect(count).toBeGreaterThanOrEqual(1)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})