import type { Plugin } from '@nunnun/harness'
import { createBashTool } from './bash.ts'
import { createEditTool } from './edit.ts'
import { createFindTool, createLsTool } from './ls-find.ts'
import { createGlobTool } from './glob.ts'
import { createGrepTool } from './grep.ts'
import { createPowerShellTool } from './powershell.ts'
import { createReadTool } from './read.ts'
import { createWriteTool } from './write.ts'

export interface ToolsPluginOptions {
  cwd: string
  timeoutMs?: number
  /** Omit a tool by name (e.g. hide `powershell` when bash suffices). */
  omit?: string[]
}

/** Registers the pi toolset: bash, powershell, read, write, edit, grep, glob, ls, find. */
export function toolsPlugin(options: ToolsPluginOptions): Plugin {
  return {
    name: 'tools',
    setup: (ctx) => {
      const all = [
        createBashTool(options),
        createPowerShellTool(options),
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createGrepTool(),
        createGlobTool(),
        createLsTool(),
        createFindTool(),
      ]
      const omit = new Set(options.omit ?? [])
      for (const tool of all) {
        if (!omit.has(tool.name)) ctx.registerTool(tool)
      }
    },
  }
}

export { createBashTool, createEditTool, createFindTool, createGlobTool, createGrepTool, createLsTool, createPowerShellTool, createReadTool, createWriteTool }
