import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'

/** Unified diff against the (possibly nonexistent) previous content — the preview payload. */
export function diffForWrite(path: string, before: string | null, after: string): string {
  return createTwoFilesPatch(path, path, before ?? '', after, 'before', 'after').trim()
}

export function createWriteTool(): Tool {
  const WriteSchema = Type.Object({
    path: Type.String({ description: 'File path to write' }),
    content: Type.String({ description: 'Full file content to write' }),
  })
  return {
    name: 'write',
    description: 'Write a file (full overwrite; creates parent directories). A diff is returned as preview.',
    schema: WriteSchema,
    execute: async (input) => {
      const args = input as { path: string; content: string }
      let before: string | null = null
      try {
        before = await readFile(args.path, 'utf8')
      } catch {
        before = null
      }
      await mkdir(dirname(args.path), { recursive: true })
      await writeFile(args.path, args.content, 'utf8')
      const diff = diffForWrite(args.path, before, args.content)
      const preview = diff.length > 8000 ? `${diff.slice(0, 8000)}\n[diff truncated]` : diff
      return { output: `wrote ${args.path} (${args.content.length} bytes)\n${preview}`, isError: false }
    },
  }
}
