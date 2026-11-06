import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'
import { runShellWith } from './shell.ts'

/** PowerShell-native shell tool (kept alongside bash; the CLI picks the default). */
export function createPowerShellTool(defaults: { cwd: string; timeoutMs?: number }): Tool {
  const PSSchema = Type.Object({
    command: Type.String({ description: 'The PowerShell command to run' }),
    timeout_ms: Type.Optional(Type.Number({ description: 'Timeout in milliseconds (default 120000)' })),
  })
  return {
    name: 'powershell',
    description: 'Run a PowerShell command directly (Windows). Returns stdout (and stderr if any).',
    schema: PSSchema,
    execute: async (input, ctx) => {
      const args = input as { command: string; timeout_ms?: number }
      const res = await runShellWith(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
        args.command,
        { cwd: ctx.cwd ?? defaults.cwd, timeoutMs: args.timeout_ms ?? defaults.timeoutMs ?? 120_000, signal: ctx.signal },
      )
      const suffix = res.exitCode === null ? '\n[aborted]' : res.exitCode !== 0 ? `\n[exit code: ${res.exitCode}]` : ''
      return { output: res.output + suffix, isError: res.exitCode === null || res.exitCode !== 0 }
    },
  }
}
