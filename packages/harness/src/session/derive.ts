import type { Message } from '@earendil-works/pi-ai'
import type { SessionEvent } from './events.ts'

/**
 * Projects the session log into the model-visible message history.
 *
 * Model-visible means derived from the log (dsh's rule): every model request
 * must be reconstructable from these events.
 *
 * - `user/message` → UserMessage
 * - `assistant/message` → AssistantMessage (stored verbatim; carries text,
 *   thinking, and toolCall parts)
 * - `tool/call` + `tool/result` → ToolResultMessage (the call itself is a
 *   part of the assistant message; the result is what the model sees)
 * - `compaction` → drops everything before `firstKeptEventSeq` and prepends
 *   the summary as a user message
 */
export function deriveMessages(events: readonly SessionEvent[]): Message[] {
  const compactions = events.filter((e) => e.type === 'compaction')
  const lastCompaction = compactions.at(-1)

  const messages: Message[] = []
  if (lastCompaction) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: String(lastCompaction.data.summary ?? '') }],
      timestamp: lastCompaction.ts,
    })
  }

  const keptSeq = lastCompaction ? Number(lastCompaction.data.firstKeptEventSeq) : -1

  for (const event of events) {
    if (event.seq < keptSeq) continue
    switch (event.type) {
      case 'user/message':
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: String(event.data.text ?? '') }],
          timestamp: event.ts,
        })
        break
      case 'assistant/message':
        messages.push(event.data.message as Message)
        break
      case 'tool/result':
        messages.push({
          role: 'toolResult',
          toolCallId: String(event.data.callId),
          toolName: String(event.data.toolName),
          content: [{ type: 'text', text: stringify(event.data.output) }],
          isError: Boolean(event.data.isError),
          timestamp: event.ts,
        })
        break
      default:
        // turn markers, tool/call (already embedded in the assistant message),
        // and compaction itself are not model-visible.
        break
    }
  }
  return messages
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
