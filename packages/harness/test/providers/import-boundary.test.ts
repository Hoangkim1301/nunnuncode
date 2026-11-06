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
  it('only providers/ may import pi-ai directly', () => {
    const violations: string[] = []
    for (const file of walk(srcDir)) {
      const inProviders = file.replaceAll('\\', '/').includes('/src/providers/')
      const content = readFileSync(file, 'utf8')
      const importsPi = /from ['"]@earendil-works\/pi-ai/.test(content)
      if (importsPi && !inProviders) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
