import type {
  AssistantMessage,
  ContentPart,
  ModelDefinition,
  ModelMessage,
  ModelProvider,
  ModelProviderStreamRequest,
  StreamEvent,
  ToolCallPart,
  Usage,
} from './types.ts'

/**
 * Own OpenAI-compatible provider (chat completions + SSE streaming).
 *
 * Covers every endpoint we use: a company gateway, OpenRouter, Ollama, vLLM,
 * LM Studio — anything speaking the OpenAI chat-completions protocol.
 *
 * What it does: build the wire request, stream SSE, assemble tool-call
 * argument deltas, map reasoning fields, honour AbortSignal, and retry
 * 429/5xx with bounded backoff (never retrying auth errors).
 */
export interface OpenAIProviderOptions {
  maxAttempts?: number
  maxRetryDelayMs?: number
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000

export function createOpenAICompatibleProvider(model: ModelDefinition, options: OpenAIProviderOptions = {}): ModelProvider {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxDelay = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS

  return {
    async *stream(req: ModelProviderStreamRequest): AsyncIterable<StreamEvent> {
      const body = buildBody(model, req)
      let response = await fetchCompletion(model, body, req.signal, maxAttempts, maxDelay, options)
      if (!response.ok) {
        const detail = await safeText(response)
        yield { type: 'error', error: `HTTP ${response.status}: ${detail}` }
        return
      }
      if (!response.body) {
        yield { type: 'error', error: 'response has no body' }
        return
      }

      yield* parseSse(response.body, req.signal)
    },
  }
}

function buildBody(model: ModelDefinition, req: ModelProviderStreamRequest): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages) messages.push(toWireMessage(m))

  const body: Record<string, unknown> = { model: model.id, messages, stream: true }
  if (req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }
  if (model.maxTokens !== undefined) body.max_tokens = model.maxTokens
  return body
}

export function toWireMessage(m: ModelMessage): Record<string, unknown> {
  if (m.role === 'user') {
    return { role: 'user', content: typeof m.content === 'string' ? m.content : textOf(m.content) }
  }
  if (m.role === 'toolResult') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: textOf(m.content) }
  }
  const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')
  const calls = m.content.filter((p): p is ToolCallPart => p.type === 'toolCall')
  const wire: Record<string, unknown> = { role: 'assistant', content: text }
  if (calls.length > 0) {
    wire.tool_calls = calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
    }))
  }
  return wire
}

function textOf(parts: ContentPart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')
}

async function fetchCompletion(
  model: ModelDefinition,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  maxAttempts: number,
  maxDelay: number,
  options: OpenAIProviderOptions,
): Promise<Response> {
  let attempt = 0
  let lastResponse: Response | undefined
  while (attempt < maxAttempts) {
    attempt++
    const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${model.apiKey}`,
        ...(options as { headers?: Record<string, string> }).headers,
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt >= maxAttempts) return res
    lastResponse = res
    const retryAfter = Number(res.headers.get('retry-after') ?? 'NaN')
    const delay = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, maxDelay) : Math.min(250 * 2 ** (attempt - 1), maxDelay)
    await sleep(delay, signal)
  }
  return lastResponse ?? new Response(null, { status: 500 })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}

/** Parse the SSE stream into our StreamEvent vocabulary. */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let stopReason = 'stop'
  let usage: Usage | undefined
  let aborted = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const data = dataLines(rawEvent)
        if (data === null) continue
        if (data === '[DONE]') continue

        let chunk: Record<string, unknown>
        try {
          chunk = JSON.parse(data) as Record<string, unknown>
        } catch {
          continue // ignore malformed keep-alive frames
        }

        const choices = (chunk.choices as Array<Record<string, unknown>> | undefined) ?? []
        const choice = choices[0]
        const d = (choice?.delta as Record<string, unknown> | undefined) ?? {}

        if (typeof d.content === 'string' && d.content !== '') yield { type: 'text-delta', delta: d.content }
        if (typeof d.reasoning_content === 'string' && d.reasoning_content !== '') {
          yield { type: 'thinking-delta', delta: d.reasoning_content }
        }
        if (typeof d.reasoning === 'string' && d.reasoning !== '') {
          yield { type: 'thinking-delta', delta: d.reasoning }
        }
        for (const tc of (d.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) {
          const index = Number(tc.index ?? 0)
          const entry = calls.get(index) ?? { id: '', name: '', args: '' }
          const fn = (tc.function as Record<string, unknown> | undefined) ?? {}
          if (typeof tc.id === 'string' && tc.id !== '') entry.id = tc.id
          if (typeof fn.name === 'string' && fn.name !== '') entry.name = fn.name
          if (typeof fn.arguments === 'string') entry.args += fn.arguments
          calls.set(index, entry)
        }
        if (typeof choice?.finish_reason === 'string' && choice.finish_reason !== null) {
          stopReason = mapStopReason(choice.finish_reason)
        }
        if (chunk.usage) usage = toUsage(chunk.usage as Record<string, number>)
      }
    }
  } catch (err) {
    if (signal?.aborted) aborted = true
    else {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) }
      return
    }
  } finally {
    reader.releaseLock?.()
  }

  for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let input: unknown = {}
    try {
      input = call.args === '' ? {} : JSON.parse(call.args)
    } catch {
      yield { type: 'error', error: `malformed tool-call arguments for ${call.name}` }
      return
    }
    yield { type: 'tool-call', callId: call.id || `call_${index}`, toolName: call.name, input }
  }

  if (aborted || signal?.aborted) {
    yield { type: 'error', error: 'aborted' }
    return
  }
  yield { type: 'done', ...(usage === undefined ? {} : { usage }), stopReason }
}

function dataLines(rawEvent: string): string | null {
  const parts = rawEvent
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  if (parts.length === 0) return null
  return parts.join('\n')
}

function mapStopReason(reason: string): string {
  if (reason === 'tool_calls' || reason === 'function_call') return 'toolUse'
  if (reason === 'length') return 'length'
  return 'stop'
}

function toUsage(raw: Record<string, number>): Usage {
  const input = raw.prompt_tokens ?? 0
  const output = raw.completion_tokens ?? 0
  return { input, output, totalTokens: raw.total_tokens ?? input + output }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ''
  }
}

export type { AssistantMessage }