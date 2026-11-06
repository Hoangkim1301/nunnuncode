import { spawn } from 'node:child_process'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'
import { truncateOutput } from './truncate.ts'

/**
 * ripgrep-backed content search (spec decision). The binary is located on
 * PATH; if absent, the tool returns a clear, actionable error instead of a
 * silent fallback.
 */
export async function findRipgrep(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('rg', ['--version'], { windowsHide: true })
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? 'rg' : null))
  })
}

export function createGrepTool(): Tool {
  const GrepSchema = Type.Object({
    pattern: Type.String({ description: 'Regular expression to search for' }),
    path: Type.Optional(Type.String({ description: 'Directory or file to search (default: cwd)' })),
  })
  return {
    name: 'grep',
    description: 'Search file contents with ripgrep. Returns matching lines with file names and line numbers.',
    schema: GrepSchema,
    execute: async (input, ctx) => {
      const args = input as { pattern: string; path?: string }
      const rg = await findRipgrep()
      if (!rg) {
        return { output: "error: ripgrep (rg) not found on PATH. Install it or set RIPGREP_PATH.", isError: true }
      }
      return new Promise((resolve) => {
        const target = args.path ?? ctx.cwd
        const child = spawn(rg, ['--line-number', '--max-columns', '500', '--', args.pattern, target], {
          cwd: ctx.cwd,
          windowsHide: true,
        })
        let out = ''
        child.stdout?.on('data', (c: Buffer) => {
          out += c.toString()
        })
        child.stderr?.on('data', (c: Buffer) => {
          out += c.toString()
        })
        child.on('error', () => resolve({ output: 'error: failed to run ripgrep', isError: true }))
        child.on('close', (code) => {
          if (out === '') return resolve({ output: `no matches for '${args.pattern}'`, isError: false })
          const t = truncateOutput(out)
          return resolve({ output: t.content, isError: code === 2 })
        })
      })
    },
  }
}
