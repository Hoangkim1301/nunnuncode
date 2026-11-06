import type { Tool, ToolContext } from '../runtime/types.ts'
import type { ConfirmFn, PolicyDecision } from './pipeline.ts'

/**
 * The default trust-ladder policy (spec: "Resolved decisions — trust model"):
 *
 * - read-only tools (read, glob, grep, ls, find) → allow
 * - mutating/executing tools (bash, powershell, write, edit) → confirm
 * - deny/observe can be forced by the daemon or the user's rules
 *
 * Session allows are memoized per (tool, cwd): "allow for this session".
 */
const READONLY_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'find'])
const CONFIRM_TOOLS = new Set(['bash', 'powershell', 'write', 'edit'])

export interface ToolPolicy {
  decide(tool: Tool, input: unknown, ctx: ToolContext): Promise<PolicyDecision>
  confirm: ConfirmFn
  rememberAllow(tool: Tool, ctx: ToolContext): void
}

export interface DefaultPolicyOptions {
  confirm: ConfirmFn
  /** Shared memo, owned by the caller (one per session). */
  sessionAllows?: Map<string, boolean>
  /** Extra tool names that require confirmation beyond the defaults. */
  confirmTools?: string[]
}

export function createDefaultPolicy(options: DefaultPolicyOptions): ToolPolicy {
  const sessionAllows = options.sessionAllows ?? new Map<string, boolean>()
  const confirmTools = new Set([...CONFIRM_TOOLS, ...(options.confirmTools ?? [])])

  return {
    async decide(tool: Tool, _input: unknown, ctx: ToolContext): Promise<PolicyDecision> {
      if (READONLY_TOOLS.has(tool.name)) return 'allow'
      if (sessionAllows.get(`${tool.name}:${ctx.cwd}`)) return 'allow'
      if (confirmTools.has(tool.name)) return 'confirm'
      return 'confirm'
    },
    confirm: options.confirm,
    rememberAllow(tool: Tool, ctx: ToolContext): void {
      sessionAllows.set(`${tool.name}:${ctx.cwd}`, true)
    },
  }
}
