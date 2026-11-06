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
      // `import type` is erased at compile time — the boundary polices runtime imports only.
      const runtimeImports = content.replace(/^import type[\s\S]*?from ['"][^'"]+['"]$/gm, '')
      const importsPi = /from ['"]@earendil-works\/pi-ai/.test(runtimeImports)
      if (importsPi && !inProviders) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
