import type { Model } from '@earendil-works/pi-ai/compat'

/**
 * Build an OpenAI-compatible chat model definition (custom gateways,
 * OpenRouter, Ollama, vLLM — the conventions carried from the Python agent).
 */
export interface OpenAICompatibleModelSpec {
  id: string
  baseUrl: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}

export function createOpenAICompatibleModel(spec: OpenAICompatibleModelSpec): Model<'openai-completions'> {
  return {
    id: spec.id,
    name: spec.id,
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: spec.baseUrl,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow ?? 128_000,
    maxTokens: spec.maxTokens ?? 8192,
    reasoning: spec.reasoning ?? true,
  }
}
