import {
  registerBuiltInApiProviders,
  streamSimple,
  type AssistantMessageEvent,
  type Message,
  type Model,
  type Tool,
} from '@earendil-works/pi-ai/compat'
import { normalizeContext } from '@earendil-works/pi-ai'
import type { ModelProvider, ModelProviderStreamRequest, StreamEvent } from './types.ts'

/**
 * pi-ai-backed ModelProvider. Wraps `streamSimple` and normalizes
 * AssistantMessageEvent into the harness StreamEvent vocabulary.
 *
 * Retry behavior is owned by pi-ai (its adapters retry 429/5xx with backoff
 * per its own retry policy and tests); this seam only forwards the options.
 */
export interface PiProviderOptions {
  model: Model<string>
  apiKey?: string
  /** Retry options forwarded to pi-ai's internal retry policy. */
  retries?: { maxAttempts?: number; maxRetryDelayMs?: number }
}

export function createPiProvider(options: PiProviderOptions): ModelProvider {
  // Built-in provider registration is idempotent; required before any stream.
  registerBuiltInApiProviders()

  return {
    async *stream(req: ModelProviderStreamRequest): AsyncIterable<StreamEvent> {
      const context = normalizeContext({
        systemPrompt: req.system,
        messages: req.messages as Message[],
        tools: req.tools as Tool[],
      })

      const eventStream = streamSimple(options.model, context, {
        ...(req.signal === undefined ? {} : { signal: req.signal }),
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.retries?.maxAttempts === undefined ? {} : { maxRetryAttempts: options.retries.maxAttempts }),
        ...(options.retries?.maxRetryDelayMs === undefined ? {} : { maxRetryDelayMs: options.retries.maxRetryDelayMs }),
      })

      for await (const event of eventStream) {
        yield* mapEvent(event)
      }
    },
  }
}

function* mapEvent(event: AssistantMessageEvent): Generator<StreamEvent> {
  switch (event.type) {
    case 'text_delta':
      if (event.delta) yield { type: 'text-delta', delta: event.delta }
      break
    case 'thinking_delta':
      if (event.delta) yield { type: 'thinking-delta', delta: event.delta }
      break
    case 'toolcall_end':
      yield {
        type: 'tool-call',
        callId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: event.toolCall.arguments,
      }
      break
    case 'done': {
      const u = event.message.usage
      yield {
        type: 'done',
        ...(u === undefined
          ? {}
          : {
              usage: {
                input: u.input ?? 0,
                output: u.output ?? 0,
                cacheRead: u.cacheRead ?? 0,
                cacheWrite: u.cacheWrite ?? 0,
                totalTokens: u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0),
              },
            }),
        ...(event.message.stopReason === undefined ? {} : { stopReason: event.message.stopReason }),
      }
      break
    }
    case 'error':
      yield { type: 'error', error: event.error?.errorMessage ?? event.error ?? new Error('unknown stream error') }
      break
    default:
      // start/text_start/text_end/thinking_start/thinking_end/toolcall_start/toolcall_delta
      // carry no new information for the harness vocabulary.
      break
  }
}
