import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { Type } from 'typebox'
import type { Tool } from '@nunnun/harness'

/**
 * Minimal glob matcher supporting `**`, `*`, `?`, and `{a,b}` alternation —
 * pure Node fs (spec: no external dependency).
 */
export function matchGlob(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern)
  return regex.test(path.replaceAll('\\', '/'))
}

export function globToRegex(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i)
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more path segments; `**` at end matches everything
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i++
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) {
        re += '\\{'
      } else {
        const alternatives = pattern.slice(i + 1, end).split(',').map(escapeRegex).join('|')
        re += `(?:${alternatives})`
        i = end
      }
    } else {
      re += escapeRegex(c)
    }
  }
  return new RegExp(`^${re}$`)
}

function escapeRegex(c: string): string {
  return /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c
}

async function walk(dir: string, base: string, out: string[], depth: number): Promise<void> {
  if (depth > 12) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, base, out, depth + 1)
    } else {
      out.push(relative(base, full).replaceAll('\\', '/'))
    }
  }
}

export async function globFiles(cwd: string, pattern: string): Promise<string[]> {
  const files: string[] = []
  await walk(cwd, cwd, files, 0)
  const rel = relative(cwd, pattern).replaceAll('\\', '/')
  return files.filter((f) => matchGlob(f, pattern) || matchGlob(f, rel)).sort()
}

export function createGlobTool(): Tool {
  const GlobSchema = Type.Object({
    pattern: Type.String({ description: 'Glob pattern, e.g. "src/**/*.ts" or "*.md"' }),
  })
  return {
    name: 'glob',
    description: 'Find files by glob pattern (supports **, *, ?, {a,b}) relative to the working directory.',
    schema: GlobSchema,
    execute: async (input, ctx) => {
      const args = input as { pattern: string }
      const matches = await globFiles(ctx.cwd, args.pattern)
      if (matches.length === 0) return { output: `no files match '${args.pattern}'`, isError: false }
      const listed = matches.slice(0, 200).join('\n')
      const suffix = matches.length > 200 ? `\n[+${matches.length - 200} more]` : ''
      return { output: `${matches.length} match(es):\n${listed}${suffix}`, isError: false }
    },
  }
}
