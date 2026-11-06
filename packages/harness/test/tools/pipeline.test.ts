import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runPipeline } from '../../src/tools/pipeline.ts'
import { SPILL_THRESHOLD } from '../../src/tools/spill.ts'
import { createDefaultPolicy } from '../../src/tools/policy.ts'
import type { Tool, ToolContext } from '../../src/runtime/types.ts'
import type { ToolResult } from '../../src/runtime/types.ts'

function makeTool(name: string, impl: (input: unknown) => Promise<ToolResult> | ToolResult, spy?: { calls: number }): Tool {
  return {
    name,
    description: '',
    schema: {},
    execute: async (input) => {
      if (spy) spy.calls++
      return impl(input)
    },
  }
}

const ctx = (): ToolContext => ({ cwd: process.cwd() })

describe('guarded tool pipeline', () => {
  it('allow policy executes the tool', async () => {
    const spy = { calls: 0 }
    const tool = makeTool('read', () => ({ output: 'file content' }), spy)
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, {}, ctx(), { policy })
    expect(result.output).toBe('file content')
    expect(spy.calls).toBe(1)
  })

  it('confirm policy: "once" executes; "session" memoizes; "deny" refuses without executing', async () => {
    const spy = { calls: 0 }
    const tool = makeTool('bash', () => ({ output: 'ran' }), spy)
    const confirm = vi.fn(async () => 'once' as const)
    let policy = createDefaultPolicy({ confirm })
    await runPipeline(tool, { command: 'a' }, ctx(), { policy })
    expect(spy.calls).toBe(1)
    expect(confirm).toHaveBeenCalledTimes(1)

    // deny: not executed
    policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const denied = await runPipeline(tool, { command: 'b' }, ctx(), { policy })
    expect(denied.isError).toBe(true)
    expect(spy.calls).toBe(1) // unchanged

    // session: memoizes after one approval
    const confirm2 = vi.fn(async () => 'session' as const)
    const session = new Map<string, boolean>()
    policy = createDefaultPolicy({ confirm: confirm2, sessionAllows: session })
    await runPipeline(tool, { command: 'c' }, ctx(), { policy })
    expect(confirm2).toHaveBeenCalledTimes(1)
    await runPipeline(tool, { command: 'd' }, ctx(), { policy })
    expect(confirm2).toHaveBeenCalledTimes(1) // memoized — no second prompt
    expect(spy.calls).toBe(3)
  })

  it('observe policy: executes NOTHING, records intent as the result', async () => {
    const spy = { calls: 0 }
    const tool = makeTool('bash', () => ({ output: 'ran' }), spy)
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const observed = await runPipeline(tool, { command: 'rm -rf /' }, ctx(), {
      policy,
      forceDecision: 'observe',
    })
    expect(spy.calls).toBe(0)
    expect(observed.isError).toBe(false)
    expect(observed.output).toContain('would have run')
  })

  it('tool errors become isError results, never throw past the pipeline', async () => {
    const tool: Tool = {
      name: 'boom',
      description: '',
      schema: {},
      execute: async () => {
        throw new Error('kaput')
      },
    }
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, {}, ctx(), {
      policy,
      forceDecision: 'allow',
    })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('kaput')
  })

  it('invalid tool arguments: reported as tool error, tool never executes', async () => {
    const spy = { calls: 0 }
    const tool: Tool = {
      name: 'read',
      description: '',
      schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async (input) => {
        spy.calls++
        return { output: `read ${(input as { path: string }).path}` }
      },
    }
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, {}, ctx(), { policy, forceDecision: 'allow' })
    expect(spy.calls).toBe(0)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('path')
  })

  it('rejects a string where a number is required, with an actionable error', async () => {
    const spy = { calls: 0 }
    const tool: Tool = {
      name: 'read',
      description: '',
      schema: { type: 'object', properties: { offset: { type: 'number' } }, required: ['offset'] },
      execute: async () => {
        spy.calls++
        return { output: 'should not run' }
      },
    }
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, { offset: '5' }, ctx(), { policy, forceDecision: 'allow' })
    expect(result.isError).toBe(true)
    expect(spy.calls).toBe(0) // never executed with the wrong type
    expect(result.output).toContain('must be number') // the model can retry correctly
  })

  it('large outputs spill to disk and the path is returned (spec: temp save)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-pipe-'))
    const tool = makeTool('bash', () => ({ output: 'x'.repeat(SPILL_THRESHOLD + 1) }))
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, {}, ctx(), { policy, forceDecision: 'allow', spillDir: dir })
    expect(result.isError).toBe(false)
    expect(result.output).toContain('[full output saved to')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a spill failure does not destroy the tool result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nunnun-pipe-'))
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x') // occupies the path where a directory is needed
    const tool = makeTool('bash', () => ({ output: 'y'.repeat(SPILL_THRESHOLD + 1) }))
    const policy = createDefaultPolicy({ confirm: async () => 'deny' })
    const result = await runPipeline(tool, {}, ctx(), {
      policy,
      forceDecision: 'allow',
      spillDir: join(blocker, 'sub'),
    })
    expect(result.isError).toBe(false)
    expect(result.output).toContain('yyyy') // the result survives intact
    rmSync(root, { recursive: true, force: true })
  })
})
