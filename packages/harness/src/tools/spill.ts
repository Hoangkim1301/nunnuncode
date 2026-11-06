import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Temp save (spec: outputs above the truncation ceiling spill to a per-session
 * dir under the OS temp dir; the path is returned to the agent; files are swept
 * on boot).
 *
 * Threshold note: the spec said 4 KB, but dogfooding showed that replacing a
 * 4–50 KB result with a 2 KB head actively loses content the model needs
 * (e.g. reading a doc). Spill now starts at the same ceiling truncation uses
 * (50 KB), so in-context results stay whole.
 */
export const SPILL_THRESHOLD = 50 * 1024
export const SPILL_TTL_MS = 24 * 60 * 60 * 1000

export function sessionSpillDir(root: string, sessionId: string): string {
  const dir = join(root, 'sessions', sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function spill(value: string, sessionDir: string): { path: string } | null {
  if (value.length <= SPILL_THRESHOLD) return null
  try {
    // Self-healing: the spill directory is created on demand. A spill failure
    // must never lose the tool result, so any error returns null.
    mkdirSync(sessionDir, { recursive: true })
    const name = `spill-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`
    const path = join(sessionDir, name)
    writeFileSync(path, value, 'utf8')
    return { path }
  } catch {
    return null
  }
}

/** Remove spill files older than ttl; returns how many were removed. */
export function sweepSpills(root: string, ttlMs: number = SPILL_TTL_MS): number {
  let removed = 0
  if (!existsSync(root)) return 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      removed += sweepSpills(full, ttlMs)
    } else {
      try {
        const age = Date.now() - statSync(full).mtimeMs
        if (age > ttlMs) {
          rmSync(full)
          removed++
        }
      } catch {
        // file already gone or unreadable — not our problem
      }
    }
  }
  return removed
}
