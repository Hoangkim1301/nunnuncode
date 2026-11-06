import { Compile, type Validator } from 'typebox/compile'
import type { Tool, ToolContext } from '../runtime/types.ts'
import type { ToolResult } from '../runtime/types.ts'
import type { ToolPolicy } from './policy.ts'
import { spill, SPILL_THRESHOLD } from './spill.ts'

export type PolicyDecision = 'allow' | 'confirm' | 'deny' | 'observe'

/** Compiled validators per tool schema (TypeBox; coerces loosely typed input). */
const validators = new WeakMap<object, Validator>()

function validateInput(tool: Tool, input: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const schema = tool.schema as Record<string, unknown> | undefined
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return { ok: true, value: input }
  }
  let validator = validators.get(tool.schema as object)
  if (!validator) {
    validator = Compile(tool.schema as never)
    validators.set(tool.schema as object, validator)
  }
  const converted = validator.Convert(input) // "42" → 42, pi's coercion behavior
  if (validator.Check(converted)) return { ok: true, value: converted }
  const detail = validator
    .Errors(converted)
    .map((e) => `${e.instancePath || '/'}: ${e.message}`)
    .join('; ')
  return { ok: false, message: `error: invalid arguments for ${tool.name} — ${detail}` }
}

export interface PipelineOptions {
  policy: ToolPolicy
  /** Test/daemon hook: force a decision (e.g. observe-only mode). */
  forceDecision?: PolicyDecision
  /** When set, tool outputs above the spill threshold are saved here and the path returned. */
  spillDir?: string
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
  // Validate + coerce BEFORE any policy/execution step: invalid arguments are
  // reported to the model as tool errors (the model retries), never executed.
  const validated = validateInput(tool, input)
  if (!validated.ok) {
    return { output: validated.message, isError: true }
  }
  input = validated.value

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
    const result = await tool.execute(input, ctx)
    return withSpill({ isError: false, ...result }, options.spillDir)
  } catch (err) {
    return { output: `error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

/** Post-execute: large outputs spill to disk and the model gets the path (spec: temp save). */
function withSpill(result: ToolResult, spillDir: string | undefined): ToolResult {
  if (!spillDir || result.output.length <= SPILL_THRESHOLD) return result
  const saved = spill(result.output, spillDir)
  if (!saved) return result
  return { ...result, output: `${result.output.slice(0, 2000)}\n[full output saved to ${saved.path}]` }
}
