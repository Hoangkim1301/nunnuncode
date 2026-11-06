import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const srcDir = join(packageRoot, 'src')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

describe('pi-ai import boundary', () => {
  it('only providers/ may talk to the network directly', () => {
    const violations: string[] = []
    for (const file of walk(srcDir)) {
      const inProviders = file.replaceAll('\\', '/').includes('/src/providers/')
      const content = readFileSync(file, 'utf8')
      if (/fetch\(/.test(content) && !inProviders) violations.push(file)
    }
    expect(violations).toEqual([])
  })

  it('no vendor SDK imports anywhere in the harness', () => {
    const violations: string[] = []
    for (const file of walk(srcDir)) {
      const content = readFileSync(file, 'utf8').replace(/^import type[\s\S]*?from ['"][^'"]+['"]$/gm, '')
      if (/@earendil-works|@anthropic-ai|from ['"]openai['"]/.test(content)) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
