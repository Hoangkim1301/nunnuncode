import { describe, expect, it, vi } from 'vitest'
import { runBatch, runPipeline } from '../../src/tools/pipeline.ts'
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

  it('runBatch honors the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const tools = [1, 2, 3, 4, 5].map((i) =>
      makeTool(`t${i}`, async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 10))
        inFlight--
        return { output: String(i) }
      }),
    )
    const results = await runBatch(tools, tools.map(() => ({})), ctx(), 2, async () => 'allow')
    expect(results).toHaveLength(5)
    expect(peak).toBe(2)
  })
})
