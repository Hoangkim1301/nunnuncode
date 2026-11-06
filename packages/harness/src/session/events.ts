/**
 * Session event types.
 *
 * Event vocabulary (dotted names, dsh-style). Model-visible facts are the
 * message-bearing events; `compaction` rewrites the derived projection.
 */
export type EventType =
  | 'turn/start'
  | 'user/message'
  | 'assistant/message'
  | 'tool/call'
  | 'tool/result'
  | 'compaction'
  | 'turn/end'

export interface SessionEvent {
  seq: number
  ts: number
  type: EventType
  data: Record<string, unknown>
}
