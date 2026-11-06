/** Output truncation — pi's rules: line limit and byte limit, whichever hits first. */
export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: 'lines' | 'bytes' | null
  totalLines: number
}

export function truncateOutput(content: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES): TruncationResult {
  const lines = content.split('\n')
  const totalLines = lines.length

  if (totalLines > maxLines) {
    return {
      content: `${lines.slice(0, maxLines).join('\n')}\n[truncated: showing ${maxLines} of ${totalLines} lines]`,
      truncated: true,
      truncatedBy: 'lines',
      totalLines,
    }
  }

  if (content.length > maxBytes) {
    // never return partial lines when cutting on bytes
    let cut = content.slice(0, maxBytes)
    const lastNewline = cut.lastIndexOf('\n')
    if (lastNewline > 0) cut = cut.slice(0, lastNewline)
    return {
      content: `${cut}\n[truncated: showing first ${cut.length} of ${content.length} bytes]`,
      truncated: true,
      truncatedBy: 'bytes',
      totalLines,
    }
  }

  return { content, truncated: false, truncatedBy: null, totalLines }
}
