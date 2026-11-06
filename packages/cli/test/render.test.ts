import { describe, expect, it } from 'vitest'
import { renderEvent, toolLabel, type RenderState } from '../src/render.ts'
import type { LiveEvent } from '@nunnun/harness'

describe('CLI renderers', () => {
  it('text deltas pass through, thinking is dimmed', () => {
    const state: RenderState = { textStarted: false }
    expect(renderEvent({ type: 'text-delta', delta: 'hi' }, state)).toBe('hi')
    const dim = renderEvent({ type: 'thinking-delta', delta: 'pondering' }, state)
    expect(dim).toContain('pondering')
    expect(dim).toContain('\x1b[2m')
  })

  it('bash tool renders ⏺ Bash(command) → ⎿ output', () => {
    const state: RenderState = { textStarted: true }
    const start = renderEvent({ type: 'tool-start', callId: 'c1', toolName: 'bash' }, state)
    expect(start).toContain('⏺ bash')
    const end = renderEvent({ type: 'tool-end', callId: 'c1', toolName: 'bash', output: 'hi\nmore', isError: false }, state)
    expect(end).toContain('⎿ hi')
    expect(end).not.toContain('more') // one line only
  })

  it('edit renders with diff-style output marker', () => {
    const state: RenderState = { textStarted: false }
    const end = renderEvent(
      { type: 'tool-end', callId: 'c2', toolName: 'edit', output: 'edited f.ts\n- old\n+ new', isError: false },
      state,
    )
    expect(end).toContain('edited f.ts')
  })

  it('toolLabel extracts the human-visible part per tool', () => {
    expect(toolLabel('bash', { command: 'ls -la' })).toBe('ls -la')
    expect(toolLabel('read', { path: '/tmp/f' })).toBe('/tmp/f')
    expect(toolLabel('glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('error events render dimmed and truncated', () => {
    const state: RenderState = { textStarted: false }
    const out = renderEvent({ type: 'error', error: 'x'.repeat(300) }, state)
    expect(out).toContain('\x1b[2m')
    expect(out.length).toBeLessThan(220)
  })
})

describe('live event type widening', () => {
  it('LiveEvent accepts StreamEvent shapes', () => {
    const ev: LiveEvent = { type: 'text-delta', delta: 'x' }
    expect(ev.type).toBe('text-delta')
  })
})
