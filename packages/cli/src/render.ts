import type { LiveEvent } from '@nunnun/harness'

/**
 * Per-tool CLI renderers (spec: "Model-facing event vocabulary").
 * Pure: LiveEvent → display string. The CLI writes exactly this.
 */
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'

export interface RenderState {
  /** True once assistant text has started (for spacing decisions). */
  textStarted: boolean
}

export function renderEvent(ev: LiveEvent, state: RenderState): string {
  switch (ev.type) {
    case 'text-delta':
      state.textStarted = true
      return ev.delta
    case 'thinking-delta':
      return `${DIM}${ev.delta}${RESET}`
    case 'tool-start': {
      state.textStarted = false
      const label = ev.preview?.text.split('\n')[0]?.slice(0, 90) ?? ''
      return `\n${CYAN}⏺ ${ev.toolName}(${label})${RESET}\n`
    }
    case 'tool-end': {
      const first = ev.output.split('\n')[0] ?? ''
      const line = first.length > 120 ? `${first.slice(0, 120)}…` : first
      return `  ⎿ ${line}${ev.isError ? ' [error]' : ''}\n`
    }
    case 'done':
      return ''
    case 'error':
      return `${DIM}[${String(ev.error).slice(0, 200)}]${RESET}`
    default:
      return ''
  }
}