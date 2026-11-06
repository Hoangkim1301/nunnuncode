import { closeSync, existsSync, openSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { deriveMessages } from './derive.ts'
import type { EventType, SessionEvent } from './events.ts'

/**
 * Append-only JSONL session log (dsh-shaped, simplified).
 *
 * - One file per session; one JSON object per line: { seq, ts, type, data }
 * - The model-visible history is always derived from the log, never held as
 *   independent state.
 * - Tolerant reader: a trailing partial line (crash mid-append) is ignored;
 *   all complete prior lines load.
 * - seq continuity: the next append continues from the highest loaded seq.
 */
export class SessionStore {
  #path: string
  #events: SessionEvent[] = []

  private constructor(path: string, events: SessionEvent[]) {
    this.#path = path
    this.#events = events
  }

  static open(path: string): SessionStore {
    const events: SessionEvent[] = []
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8')
      const lines = content.split('\n')
      // A trailing partial line (crash mid-append) is tolerated and ignored.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line === undefined || line.trim() === '') continue
        let parsed: SessionEvent
        try {
          parsed = JSON.parse(line) as SessionEvent
        } catch {
          if (i === lines.length - 1) break // torn tail
          throw new Error(`corrupt session log at ${path}, line ${i + 1}`)
        }
        events.push(parsed)
      }
    }
    return new SessionStore(path, events)
  }

  append(type: EventType, data: Record<string, unknown>): SessionEvent {
    const last = this.#events.at(-1)
    const event: SessionEvent = {
      seq: last ? last.seq + 1 : 0,
      ts: Date.now(),
      type,
      data,
    }
    appendFileSync(this.#path, JSON.stringify(event) + '\n', 'utf8')
    this.#events.push(event)
    return event
  }

  events(): readonly SessionEvent[] {
    return this.#events
  }

  deriveMessages(): ReturnType<typeof deriveMessages> {
    return deriveMessages(this.#events)
  }

  /** Durable compaction entry: replaces older history in the derived projection. */
  compact(summary: string, firstKeptEventSeq: number): SessionEvent {
    return this.append('compaction', { summary, firstKeptEventSeq })
  }
}

// Re-exports for consumers that prefer flat access.
export { deriveMessages }
export type { EventType, SessionEvent }
