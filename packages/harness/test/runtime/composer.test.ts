import { describe, expect, it } from 'vitest'
import { compose, type Plugin } from '../../src/runtime/composer.ts'

describe('plugin composer', () => {
  it('composes plugins in order; registered tools are visible in registration order', () => {
    const names: string[] = []
    const pluginA: Plugin = {
      name: 'a',
      setup: (ctx) => {
        names.push('a')
        ctx.registerTool({ name: 'tool-a', description: '', schema: {}, execute: async () => ({ output: '' }) })
      },
    }
    const pluginB: Plugin = {
      name: 'b',
      setup: (ctx) => {
        names.push('b')
        ctx.registerTool({ name: 'tool-b', description: '', schema: {}, execute: async () => ({ output: '' }) })
      },
    }

    const ctx = compose([pluginA, pluginB], {})
    expect(names).toEqual(['a', 'b'])
    expect(ctx.tools.map((t) => t.name)).toEqual(['tool-a', 'tool-b'])
  })

  it('provide: duplicate key throws', () => {
    const p: Plugin = {
      name: 'dupe',
      setup: (ctx) => {
        ctx.provide('x', 1)
        ctx.provide('x', 2)
      },
    }
    expect(() => compose([p], {})).toThrow(/already provided/)
  })

  it('events fire handlers in registration order', async () => {
    const order: string[] = []
    const mk = (n: string): Plugin => ({
      name: n,
      setup: (ctx) => {
        ctx.on('test/event', async () => {
          order.push(n)
        })
      },
    })
    const ctx = compose([mk('first'), mk('second')], {})
    await ctx.emit('test/event', {})
    expect(order).toEqual(['first', 'second'])
  })

  it('services are retrievable by key', () => {
    const p: Plugin = {
      name: 'svc',
      setup: (ctx) => {
        ctx.provide('answer', 42)
      },
    }
    const ctx = compose([p], {})
    expect(ctx.get<number>('answer')).toBe(42)
  })
})
