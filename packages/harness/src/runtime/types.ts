/**
 * Shared types for the plugin runtime (Phase 0 cap: config-driven composer —
 * no effect unwinding, no manifest loading, no hot-swap; spec-binding).
 */
import type { Static, TSchema } from 'typebox'

/** Tool result shape (kept minimal; details are tool-owned JSON). */
export interface ToolResult {
  output: string
  details?: unknown
  isError?: boolean
}

/** The model-facing tool interface. Schemas are TypeBox-native (spec decision). */
export interface Tool {
  name: string
  description: string
  schema: TSchema
  execute(input: Static<TSchema> | unknown, ctx: ToolContext): Promise<ToolResult>
}

/** Per-execution context handed to tools. */
export interface ToolContext {
  cwd: string
  signal?: AbortSignal
  /** Extra policy state (e.g. session-allow memo) — owned by the pipeline. */
  [key: string]: unknown
}

export type Unsubscribe = () => void

export interface PluginContext {
  registerTool(tool: Tool): void
  on(event: string, handler: (payload: unknown) => Promise<void> | void): Unsubscribe
  provide<T>(key: string, value: T): void
}

/** The composed harness context: what the loop, pipeline, and surfaces consume. */
export interface HarnessContext {
  /** Tools in registration order (last plugin wins on duplicate names). */
  tools: Tool[]
  /** Fire-and-forget event dispatch; handlers run in registration order. */
  emit(event: string, payload: unknown): Promise<void>
  /** Service lookup registered via provide(). */
  get<T>(key: string): T
}

export interface Plugin {
  name: string
  setup(ctx: PluginContext): void
}
