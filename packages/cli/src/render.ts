import type { LiveEvent } from '@nunnun/harness'

/**
 * Per-tool CLI renderers (spec: "Model-facing event vocabulary").
 * Pure functions: LiveEvent stream → display lines. Tested as snapshots.
 */
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'

export interface RenderState {
  /** Text accumulated for the current assistant message. */
  textStarted: boolean
}

export function renderEvent(ev: LiveEvent, state: RenderState): string {
  switch (ev.type) {
    case 'text-delta':
      state.textStarted = true
      return ev.delta
    case 'thinking-delta':
      return `${DIM}${ev.delta}${RESET}`
    case 'tool-start':
      state.textStarted = false
      return `\n${CYAN}⏺ ${ev.toolName}(${summarizeToolInput(ev.toolName, ev.callId)})${RESET}\n`
    case 'tool-end':
      return `  ⎿ ${oneLine(ev.output)}\n`
    case 'done':
      return state.textStarted ? '' : ''
    case 'error':
      return `${DIM}[${String(ev.error).slice(0, 200)}]${RESET}`
    default:
      return ''
  }
}

function summarizeToolInput(toolName: string, callId: string): string {
  void callId
  return toolName === 'bash' || toolName === 'powershell' ? '…' : ''
}

function oneLine(output: string): string {
  const first = output.split('\n')[0] ?? ''
  const line = first.length > 100 ? `${first.slice(0, 100)}…` : first
  return line
}

export function toolLabel(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'bash':
    case 'powershell':
      return String(args.command ?? '').slice(0, 80)
    case 'read':
      return String(args.path ?? '')
    case 'write':
    case 'edit':
      return String(args.path ?? '')
    case 'glob':
      return String(args.pattern ?? '')
    case 'grep':
      return String(args.pattern ?? '')
    default:
      return ''
  }
}
