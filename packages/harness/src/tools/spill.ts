import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Temp save (spec: outputs >4 KB spill to a per-session dir under the OS
 * temp dir; the path is returned to the agent; files are swept on boot).
 */
export const SPILL_THRESHOLD = 4 * 1024
export const SPILL_TTL_MS = 24 * 60 * 60 * 1000

export function sessionSpillDir(root: string, sessionId: string): string {
  const dir = join(root, 'sessions', sessionId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function spill(value: string, sessionDir: string): { path: string } | null {
  if (value.length <= SPILL_THRESHOLD) return null
  const name = `spill-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`
  const path = join(sessionDir, name)
  writeFileSync(path, value, 'utf8')
  return { path }
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
