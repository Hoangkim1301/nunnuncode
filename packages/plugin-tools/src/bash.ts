import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'
import { runShell } from './shell.ts'

export function createBashTool(defaults: { cwd: string; timeoutMs?: number }): Tool {
  const ShellSchema = Type.Object({
    command: Type.String({ description: 'The shell command to run' }),
    timeout_ms: Type.Optional(Type.Number({ description: 'Timeout in milliseconds (default 120000)' })),
  })
  return {
    name: 'bash',
    description:
      'Run a shell command. On Windows this runs PowerShell; on Unix, bash. ' +
      'Returns stdout (and stderr if any). Aborting kills the process.',
    schema: ShellSchema,
    execute: async (input, ctx) => {
      const args = input as { command: string; timeout_ms?: number }
      const res = await runShell(args.command, {
        cwd: ctx.cwd ?? defaults.cwd,
        timeoutMs: args.timeout_ms ?? defaults.timeoutMs ?? 120_000,
        signal: ctx.signal,
      })
      const suffix = res.exitCode === null ? '\n[aborted]' : res.exitCode !== 0 ? `\n[exit code: ${res.exitCode}]` : ''
      return { output: res.output + suffix, isError: res.exitCode === null || res.exitCode !== 0 }
    },
  }
}
