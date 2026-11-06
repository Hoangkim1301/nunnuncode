import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'

export function createLsTool(): Tool {
  const LsSchema = Type.Object({
    path: Type.Optional(Type.String({ description: 'Directory to list (default: cwd)' })),
  })
  return {
    name: 'ls',
    description: 'List directory entries with type markers (d = directory).',
    schema: LsSchema,
    execute: async (input, ctx) => {
      const args = input as { path?: string }
      const dir = args.path ?? ctx.cwd
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        const lines = await Promise.all(
          entries.map(async (e) => {
            if (e.isDirectory()) return `d ${e.name}/`
            const s = await stat(join(dir, e.name)).catch(() => null)
            return `  ${e.name}${s ? ` (${s.size} bytes)` : ''}`
          }),
        )
        return { output: lines.join('\n') || '(empty)', isError: false }
      } catch {
        return { output: `error: cannot list '${dir}'`, isError: true }
      }
    },
  }
}

export function createFindTool(): Tool {
  const FindSchema = Type.Object({
    pattern: Type.String({ description: 'Filename substring or glob to find (searches recursively)' }),
  })
  return {
    name: 'find',
    description: 'Find files by name (substring or glob) recursively under the working directory.',
    schema: FindSchema,
    execute: async (input, ctx) => {
      const args = input as { pattern: string }
      const { globFiles } = await import('./glob.ts')
      const matches = await globFiles(ctx.cwd, `**/*${args.pattern}*`)
      if (matches.length === 0) return { output: `no files match '${args.pattern}'`, isError: false }
      const listed = matches.slice(0, 200).join('\n')
      const suffix = matches.length > 200 ? `\n[+${matches.length - 200} more]` : ''
      return { output: `${matches.length} match(es):\n${listed}${suffix}`, isError: false }
    },
  }
}
