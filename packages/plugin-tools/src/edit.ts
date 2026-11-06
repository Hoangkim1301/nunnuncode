import { readFile, writeFile } from 'node:fs/promises'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'
/**
 * Exact-match single replacement (pi's rule: the old string must match
 * exactly once; otherwise the edit is refused, never guessed).
 */
export function applyEdit(content: string, oldString: string, newString: string): { ok: true; result: string } | { ok: false; error: string } {
  if (oldString === '') return { ok: false, error: 'error: old_string must not be empty' }
  const first = content.indexOf(oldString)
  if (first === -1) return { ok: false, error: 'error: old_string not found in file' }
  const second = content.indexOf(oldString, first + 1)
  if (second !== -1) return { ok: false, error: 'error: old_string matches more than once; provide more context to make it unique' }
  return { ok: true, result: content.slice(0, first) + newString + content.slice(first + oldString.length) }
}

export function createEditTool(): Tool {
  const EditSchema = Type.Object({
    path: Type.String({ description: 'File path to edit' }),
    old_string: Type.String({ description: 'Exact text to replace (must match exactly once)' }),
    new_string: Type.String({ description: 'Replacement text' }),
  })
  return {
    name: 'edit',
    description: 'Edit a file by replacing an exact string. The match must be unique; a unified diff is returned.',
    schema: EditSchema,
    execute: async (input) => {
      const args = input as { path: string; old_string: string; new_string: string }
      let content: string
      try {
        content = await readFile(args.path, 'utf8')
      } catch {
        return { output: `error: cannot read '${args.path}'`, isError: true }
      }
      const applied = applyEdit(content, args.old_string, args.new_string)
      if (!applied.ok) return { output: applied.error, isError: true }
      await writeFile(args.path, applied.result, 'utf8')
      const preview =
        args.new_string.length + args.old_string.length > 8000
          ? `[edit applied; ${args.new_string.length} bytes written]`
          : `- ${args.old_string.split('\n').join('\n- ')}\n+ ${args.new_string.split('\n').join('\n+ ')}`
      return { output: `edited ${args.path}\n${preview}`, isError: false }
    },
  }
}
