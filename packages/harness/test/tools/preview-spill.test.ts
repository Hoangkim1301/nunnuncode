import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPreview } from '../../src/tools/preview.ts'
import { SPILL_THRESHOLD, spill, sweepSpills } from '../../src/tools/spill.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('tool previews', () => {
  it('bash preview shows the command', () => {
    const p = buildPreview('bash', { command: 'echo hi' })
    expect(p?.kind).toBe('command')
    expect(p?.text).toContain('echo hi')
  })

  it('edit preview shows old/new block', () => {
    const p = buildPreview('edit', { path: 'f.ts', old_string: 'a', new_string: 'b' })
    expect(p?.kind).toBe('diff')
    expect(p?.text).toContain('- a')
    expect(p?.text).toContain('+ b')
  })

  it('write preview shows the content as an added diff', () => {
    const p = buildPreview('write', { path: 'f.ts', content: 'line1\nline2' })
    expect(p?.kind).toBe('diff')
    expect(p?.text).toContain('+ line1')
  })

  it('read-only tools get no preview', () => {
    expect(buildPreview('read', { path: 'x' })).toBeNull()
    expect(buildPreview('grep', { pattern: 'x' })).toBeNull()
  })
})

describe('temp spill', () => {
  it('spills only above the threshold, returns the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-spill-'))
    dirs.push(dir)

    const small = spill('tiny', dir)
    expect(small).toBeNull()

    const big = spill('x'.repeat(SPILL_THRESHOLD + 1), dir)
    expect(big).not.toBeNull()
    expect(existsSync(big!.path)).toBe(true)
    expect(readFileSync(big!.path, 'utf8')).toBe('x'.repeat(SPILL_THRESHOLD + 1))
  })

  it('creates a missing spill directory (first run on a fresh machine)', () => {
    const root = mkdtempSync(join(tmpdir(), 'nunnun-spill-'))
    dirs.push(root)
    const missing = join(root, 'does', 'not', 'exist')
    const saved = spill('y'.repeat(SPILL_THRESHOLD + 1), missing)
    expect(saved).not.toBeNull()
    expect(existsSync(saved!.path)).toBe(true)
  })

  it('returns null instead of throwing when the spill target cannot be written', () => {
    const root = mkdtempSync(join(tmpdir(), 'nunnun-spill-'))
    dirs.push(root)
    // a *file* occupies the path where a directory is needed
    const filePath = join(root, 'blocker')
    writeFileSync(filePath, 'x')
    const saved = spill('z'.repeat(SPILL_THRESHOLD + 1), join(filePath, 'sub'))
    expect(saved).toBeNull()
  })

  it('sweep removes only expired files and returns the count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-spill-'))
    dirs.push(dir)
    const fresh = spill('f'.repeat(SPILL_THRESHOLD + 1), dir)
    const stale = spill('s'.repeat(SPILL_THRESHOLD + 1), dir)
    const old = new Date(Date.now() - 10_000)
    utimesSync(stale!.path, old, old)

    const removed = sweepSpills(dir, 5_000)
    expect(removed).toBe(1)
    expect(existsSync(stale!.path)).toBe(false)
    expect(existsSync(fresh!.path)).toBe(true)
  })
})
