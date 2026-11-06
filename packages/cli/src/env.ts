import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Env conventions carried from the Python agent (spec: Global Constraints):
 * API_BASE_URL (default OpenRouter), API_KEY, MODEL.
 * Precedence: process.env > .env file (cwd, then repo walk-up).
 */
export interface ProviderEnv {
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  thinking: boolean
  source: 'env' | 'dotfile' | 'default'
}

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

export function findDotenv(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) return candidate
    const parent = join(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
  return null
}

export function resolveProviderEnv(cwd: string, env: NodeJS.ProcessEnv = process.env): ProviderEnv {
  const fromEnv = env.API_KEY ?? env.OPENROUTER_API_KEY
  const dotenvPath = findDotenv(cwd)
  const dot = dotenvPath ? parseDotenv(readFileSync(dotenvPath, 'utf8')) : {}

  const apiKey = fromEnv ?? dot.API_KEY ?? dot.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'No API key found. Set API_KEY (or OPENROUTER_API_KEY) in the environment or in a .env file.',
    )
  }

  const baseUrl = env.API_BASE_URL ?? dot.API_BASE_URL ?? DEFAULT_BASE_URL
  const model = env.MODEL ?? dot.MODEL ?? 'z-ai/glm-4.6'
  const contextWindow = Number(env.CONTEXT_WINDOW ?? dot.CONTEXT_WINDOW ?? 128_000) || 128_000
  const thinking = (env.THINKING ?? dot.THINKING ?? '1') !== '0'

  return {
    baseUrl,
    apiKey,
    model,
    contextWindow,
    thinking,
    source: fromEnv ? 'env' : dotenvPath ? 'dotfile' : 'default',
  }
}
