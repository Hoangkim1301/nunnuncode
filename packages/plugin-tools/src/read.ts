import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'
import { truncateOutput } from './truncate.ts'

export function createReadTool(): Tool {
  const ReadSchema = Type.Object({
    path: Type.String({ description: 'File path (absolute, or relative to the working directory)' }),
    offset: Type.Optional(Type.Number({ description: '1-based start line' })),
    limit: Type.Optional(Type.Number({ description: 'Number of lines to read (default: whole file, capped)' })),
  })
  return {
    name: 'read',
    description: 'Read a file. Supports line ranges via offset/limit. Output is truncated to 2000 lines / 50KB.',
    schema: ReadSchema,
    execute: async (input, ctx) => {
      const args = input as { path: string; offset?: number; limit?: number }
      const target = isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path)
      let content: string
      try {
        content = await readFile(target, 'utf8')
      } catch {
        return { output: `error: cannot read '${args.path}'`, isError: true }
      }

      let text = content
      if (args.offset !== undefined || args.limit !== undefined) {
        const lines = content.split('\n')
        const start = Math.max(0, (args.offset ?? 1) - 1)
        const end = args.limit !== undefined ? start + args.limit : lines.length
        text = lines
          .slice(start, end)
          .map((line, i) => `${String(start + i + 1).padStart(6)}  ${line}`)
          .join('\n')
      } else {
        text = content
          .split('\n')
          .map((line, i) => `${String(i + 1).padStart(6)}  ${line}`)
          .join('\n')
      }

      const t = truncateOutput(text)
      return { output: t.content, isError: false }
    },
  }
}
