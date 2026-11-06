import type { HarnessContext, Plugin, PluginContext, Tool } from './types.ts'

export type { HarnessContext, Plugin, PluginContext, Tool, Unsubscribe } from './types.ts'

/**
 * The Phase 0 plugin composer (spec's binding cap): a config-driven module
 * composer. Plugins register in order; registrations are plain effects.
 *
 * Explicitly NOT here: effect unwinding on unload, manifest loading,
 * hot-swap. It grows only when a real second consumer exists (spec).
 */
export function compose(plugins: Plugin[], _config: object): HarnessContext {
  const tools: Tool[] = []
  const services = new Map<string, unknown>()
  const handlers = new Map<string, Array<(payload: unknown) => Promise<void> | void>>()

  for (const plugin of plugins) {
    const ctx: PluginContext = {
      registerTool(tool: Tool) {
        const existing = tools.findIndex((t) => t.name === tool.name)
        if (existing >= 0) tools[existing] = tool
        else tools.push(tool)
      },
      on(event, handler) {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return () => {
          const l = handlers.get(event)
          if (!l) return
          const i = l.indexOf(handler)
          if (i >= 0) l.splice(i, 1)
        }
      },
      provide<T>(key: string, value: T) {
        if (services.has(key)) throw new Error(`service '${key}' already provided`)
        services.set(key, value)
      },
    }
    plugin.setup(ctx)
  }

  return {
    tools,
    async emit(event: string, payload: unknown): Promise<void> {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload)
      }
    },
    get<T>(key: string): T {
      const v = services.get(key)
      if (v === undefined) throw new Error(`no service provided for '${key}'`)
      return v as T
    },
  }
}

