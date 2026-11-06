/**
 * Per-tool preview payloads (spec: "Tool preview" — edit/write render a diff,
 * bash shows the command). Surfaces render these; the pipeline attaches them
 * to tool/call events.
 */
export interface PreviewPayload {
  kind: 'diff' | 'command'
  text: string
}

const PREVIEW_TOOLS_DIFF = new Set(['edit', 'write'])
const PREVIEW_TOOLS_COMMAND = new Set(['bash', 'powershell'])

export function buildPreview(tool: string, input: unknown): PreviewPayload | null {
  const args = (input ?? {}) as Record<string, unknown>
  if (PREVIEW_TOOLS_COMMAND.has(tool) && typeof args.command === 'string') {
    return { kind: 'command', text: args.command }
  }
  if (PREVIEW_TOOLS_DIFF.has(tool)) {
    if (tool === 'edit' && typeof args.old_string === 'string' && typeof args.new_string === 'string') {
      return {
        kind: 'diff',
        text: `- ${String(args.old_string).split('\n').join('\n- ')}\n+ ${String(args.new_string).split('\n').join('\n+ ')}`,
      }
    }
    if (tool === 'write' && typeof args.content === 'string') {
      const added = String(args.content)
        .split('\n')
        .map((l) => `+ ${l}`)
        .join('\n')
      return { kind: 'diff', text: added }
    }
  }
  return null
}
