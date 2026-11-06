import type { HarnessContext, Tool } from '../runtime/composer.ts'
import type { ModelProvider, StreamEvent } from '../providers/types.ts'
import { SessionStore } from '../session/store.ts'

/**
 * Live event = what a surface (CLI, web) sees while a turn runs.
 * Mirrors StreamEvent plus the tool lifecycle.
 */
export type LiveEvent =
  | StreamEvent
  | { type: 'tool-start'; callId: string; toolName: string }
  | { type: 'tool-end'; callId: string; toolName: string; output: string; isError: boolean }

type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }

const DONE_STOP_REASONS = new Set(['stop', 'length', 'toolUse', 'deferred'])

/**
 * The agent loop (reshaped from pi-agent-core's engine):
 *
 * A **step** is one model request plus the tools it calls. A **turn** is zero
 * or more steps, closing when nothing is owed. History is derived from the
 * session log — the loop never holds model state of its own.
 *
 * Borrowed reliability rules from pi:
 * - a `length` stop means truncated tool arguments → fail those calls as
 *   tool errors instead of executing them
 * - an aborted/errored stream ends the turn; pending tool calls are stripped
 *   from the stored assistant message so the log never dangles
 */
export class AgentLoop {
  #ctx: HarnessContext
  #session: SessionStore
  #provider: ModelProvider
  #system: string

  constructor(ctx: HarnessContext, session: SessionStore, provider: ModelProvider, system: string) {
    this.#ctx = ctx
    this.#session = session
    this.#provider = provider
    this.#system = system
  }

  async *run(input: string, signal?: AbortSignal): AsyncIterable<LiveEvent> {
    this.#session.append('user/message', { text: input })

    let hasMoreToolCalls = true
    while (hasMoreToolCalls) {
      hasMoreToolCalls = false

      const messages = this.#session.deriveMessages()
      const parts: AssistantPart[] = []
      let stopReason = 'stop'
      let sawDone = false

      for await (const ev of this.#provider.stream({
        system: this.#system,
        messages,
        tools: this.#ctx.tools.map(toSchema),
        signal,
      })) {
        if (ev.type === 'text-delta') {
          parts.push({ type: 'text', text: ev.delta })
          yield ev
        } else if (ev.type === 'thinking-delta') {
          parts.push({ type: 'thinking', thinking: ev.delta })
          yield ev
        } else if (ev.type === 'tool-call') {
          parts.push({ type: 'toolCall', id: ev.callId, name: ev.toolName, arguments: ev.input as Record<string, unknown> })
          yield ev
        } else if (ev.type === 'done') {
          sawDone = true
          stopReason = ev.stopReason ?? 'stop'
          yield ev
        } else if (ev.type === 'error') {
          sawDone = true
          stopReason = signal?.aborted ? 'aborted' : 'error'
          yield ev
        }
      }

      // Stream ended without a terminal event (provider dropped or abort raced):
      // treat as aborted.
      if (!sawDone) stopReason = 'aborted'

      // Pending tool calls that will not be executed are stripped, so the log
      // never shows a call without a result.
      const pendingCalls = parts.filter((p): p is Extract<AssistantPart, { type: 'toolCall' }> => p.type === 'toolCall')
      const turnFailed = stopReason === 'error' || stopReason === 'aborted'
      const willExecute = pendingCalls.length > 0 && !turnFailed
      const storedParts = willExecute ? parts : parts.filter((p) => p.type !== 'toolCall')

      this.#session.append('assistant/message', {
        message: {
          role: 'assistant',
          content: storedParts,
          api: 'openai-completions',
          provider: 'nunnuncode',
          model: 'unknown',
          usage: { input: 0, output: 0, totalTokens: 0 },
          stopReason,
          timestamp: Date.now(),
        },
      })

      if (!willExecute) break

      for (const call of pendingCalls) {
        if (stopReason === 'length') {
          // pi's rule: truncated output means truncated arguments — fail, don't run.
          this.#session.append('tool/call', { callId: call.id, toolName: call.name, input: call.arguments })
          const result = { output: 'output truncated before tool arguments completed', isError: true }
          this.#session.append('tool/result', {
            callId: call.id,
            toolName: call.name,
            output: result.output,
            isError: true,
          })
          yield { type: 'tool-start', callId: call.id, toolName: call.name }
          yield { type: 'tool-end', callId: call.id, toolName: call.name, ...result }
          continue
        }

        this.#session.append('tool/call', { callId: call.id, toolName: call.name, input: call.arguments })
        yield { type: 'tool-start', callId: call.id, toolName: call.name }

        const tool = this.#ctx.tools.find((t) => t.name === call.name)
        let output: string
        let isError = false
        if (!tool) {
          output = `error: unknown tool '${call.name}'`
          isError = true
        } else {
          try {
            const res = await tool.execute(call.arguments, { cwd: process.cwd(), signal })
            output = res.output
            isError = res.isError ?? false
          } catch (err) {
            output = `error: ${err instanceof Error ? err.message : String(err)}`
            isError = true
          }
        }

        this.#session.append('tool/result', { callId: call.id, toolName: call.name, output, isError })
        yield { type: 'tool-end', callId: call.id, toolName: call.name, output, isError }
      }

      hasMoreToolCalls = willExecute
    }
  }
}

function toSchema(tool: Tool): unknown {
  return { name: tool.name, description: tool.description, parameters: tool.schema }
}
