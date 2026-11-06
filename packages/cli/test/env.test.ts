import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL, resolveProviderEnv } from '../src/env.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('env resolution', () => {
  it('errors clearly when no key is present anywhere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-env-'))
    dirs.push(dir)
    expect(() => resolveProviderEnv(dir, {})).toThrow(/API_KEY/)
  })

  it('process env wins over dotfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-env-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), 'API_KEY=from-dotfile\nAPI_BASE_URL=https://dot.example/v1\nMODEL=dot-model')
    const e = resolveProviderEnv(dir, { API_KEY: 'from-env', MODEL: 'env-model' })
    expect(e.apiKey).toBe('from-env')
    expect(e.baseUrl).toBe('https://dot.example/v1')
    expect(e.model).toBe('env-model')
    expect(e.source).toBe('env')
  })

  it('dotfile values used when env empty; OpenRouter defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-env-'))
    dirs.push(dir)
    writeFileSync(join(dir, '.env'), 'API_KEY=dot-key')
    const e = resolveProviderEnv(dir, {})
    expect(e.apiKey).toBe('dot-key')
    expect(e.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(e.source).toBe('dotfile')
  })

  it('OPENROUTER_API_KEY accepted as fallback key name', () => {
    const e = resolveProviderEnv(process.cwd(), { OPENROUTER_API_KEY: 'k' })
    expect(e.apiKey).toBe('k')
  })

  it('walks up to find .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nunnun-env-'))
    dirs.push(dir)
    const nested = join(dir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(dir, '.env'), 'API_KEY=upstream')
    const e = resolveProviderEnv(nested, {})
    expect(e.apiKey).toBe('upstream')
  })
})

