/**
 * The provider layer: our own message model, seam, and stream vocabulary.
 *
 * This is the one place in the harness that talks HTTP to a model endpoint.
 * Everything above speaks these types; no vendor SDK is involved.
 */

export interface TextPart {
  type: 'text'
  text: string
}

export interface ThinkingPart {
  type: 'thinking'
  thinking: string
}

export interface ToolCallPart {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ContentPart = TextPart | ThinkingPart | ToolCallPart

export interface Usage {
  input: number
  output: number
  totalTokens: number
}

export interface UserMessage {
  role: 'user'
  content: string | TextPart[]
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: ContentPart[]
  usage?: Usage
  stopReason?: string
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: TextPart[]
  isError: boolean
  timestamp: number
}

export type ModelMessage = UserMessage | AssistantMessage | ToolResultMessage

/** A model-facing tool declaration (TypeBox/JSON Schema parameters). */
export interface ToolSchema {
  name: string
  description: string
  parameters: unknown
}

/** Events the seam yields while a step streams. */
export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'thinking-delta'; delta: string }
  | { type: 'tool-call'; callId: string; toolName: string; input: unknown }
  | { type: 'done'; usage?: Usage; stopReason?: string }
  | { type: 'error'; error: unknown }

export interface ModelProviderStreamRequest {
  system: string
  messages: ModelMessage[]
  tools: ToolSchema[]
  signal?: AbortSignal
  retries?: { maxAttempts?: number; maxRetryDelayMs?: number }
}

export interface ModelProvider {
  stream(req: ModelProviderStreamRequest): AsyncIterable<StreamEvent>
}

/** An OpenAI-compatible chat model definition (gateway, OpenRouter, Ollama, vLLM…). */
export interface ModelDefinition {
  id: string
  baseUrl: string
  apiKey: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}