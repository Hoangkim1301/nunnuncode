/**
 * The ModelProvider seam: the ONLY place in the harness allowed to import
 * pi-ai directly. Everything above this file speaks the harness vocabulary.
 *
 * See spec: `docs/superpowers/specs/2026-11-06-personal-agent-harness-design.md`
 * — "Tech stack: pi-ai behind our own ModelProvider seam".
 */
export type { Message as ModelMessage, Tool as ToolSchema } from '@earendil-works/pi-ai'

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'thinking-delta'; delta: string }
  | { type: 'tool-call'; callId: string; toolName: string; input: unknown }
  | {
      type: 'done'
      usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
      stopReason?: string
    }
  | { type: 'error'; error: unknown }

export interface ModelProviderStreamRequest {
  system: string
  messages: unknown[]
  tools: unknown[]
  signal?: AbortSignal
  retries?: { maxAttempts?: number; maxRetryDelayMs?: number }
}

export interface ModelProvider {
  stream(req: ModelProviderStreamRequest): AsyncIterable<StreamEvent>
}
