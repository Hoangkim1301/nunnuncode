import type { Tool, ToolContext } from '../runtime/types.ts'
import type { ToolResult } from '../runtime/types.ts'
import type { ToolPolicy } from './policy.ts'

export type PolicyDecision = 'allow' | 'confirm' | 'deny' | 'observe'

export interface PipelineOptions {
  policy: ToolPolicy
  /** Test/daemon hook: force a decision (e.g. observe-only mode). */
  forceDecision?: PolicyDecision
}

export type ConfirmResponse = 'once' | 'session' | 'deny'
export type ConfirmFn = (req: { tool: string; input: unknown }) => Promise<ConfirmResponse>

export type ExecuteToolFn = (tool: Tool, input: unknown, ctx: ToolContext) => Promise<ToolResult>

/**
 * The guarded pipeline: pre-execute (policy) → execute → post-execute.
 *
 * Policy outcomes:
 * - `allow` → execute
 * - `confirm` → ask the ConfirmFn; 'once' executes, 'session' executes and
 *   memoizes the allow, 'deny' refuses (tool never runs)
 * - `deny` → refuse
 * - `observe` → NEVER executes; records what would have run as the result
 *
 * Tool errors never propagate: they become isError results (the model sees
 * them and can retry).
 */
export async function runPipeline(tool: Tool, input: unknown, ctx: ToolContext, options: PipelineOptions): Promise<ToolResult> {
  const decision = options.forceDecision ?? (await options.policy.decide(tool, input, ctx))

  if (decision === 'deny') {
    return { output: `blocked by policy: ${tool.name} was not run`, isError: true }
  }

  if (decision === 'confirm') {
    const answer = await options.policy.confirm({ tool: tool.name, input })
    if (answer === 'deny') {
      return { output: `denied by user: ${tool.name} was not run`, isError: true }
    }
    if (answer === 'session') options.policy.rememberAllow(tool, ctx)
  }

  if (decision === 'observe') {
    return {
      output: `[observe-only] would have run ${tool.name} with ${JSON.stringify(input)}`,
      isError: false,
      details: { observed: true, tool: tool.name, input },
    }
  }

  try {
    return await tool.execute(input, ctx)
  } catch (err) {
    return { output: `error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

/**
 * Run a batch of tool calls with a concurrency limit. Results keep call order.
 * (pi supports sequential/parallel modes; Phase 0 always batches with a limit.)
 */
export async function runBatch(
  tools: Tool[],
  inputs: unknown[],
  ctx: ToolContext,
  concurrency: number,
  decide: (tool: Tool, input: unknown) => Promise<PolicyDecision>,
): Promise<ToolResult[]> {
  const results: ToolResult[] = new Array(tools.length)
  let next = 0
  const limit = Math.max(1, Math.min(concurrency, tools.length))

  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= tools.length) return
      const tool = tools[i]
      const input = inputs[i]
      if (tool === undefined) return
      const decision = await decide(tool, input)
      if (decision === 'allow') {
        try {
          results[i] = await tool.execute(input, ctx)
        } catch (err) {
          results[i] = { output: `error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
        }
      } else if (decision === 'observe') {
        results[i] = { output: `[observe-only] would have run ${tool.name} with ${JSON.stringify(input)}`, isError: false }
      } else {
        results[i] = { output: `blocked by policy: ${tool.name} was not run`, isError: true }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
