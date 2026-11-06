import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../src/providers/types.ts'

describe('types import', () => {
  it('loads providers/types.ts', () => {
    const e: StreamEvent = { type: 'done' }
    expect(e.type).toBe('done')
  })
})
