import { describe, expect, it } from 'vitest'
import { zzMin4 } from '../src/zz-min4.ts'

describe('fresh package: src file with runtime pi-ai import', () => {
  it('loads', () => {
    expect(zzMin4()).toBe('function')
  })
})
