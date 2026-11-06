import { arr, obj, str } from '@earendil-works/pi-schema'
import { describe, expect, it } from 'vitest'

describe('schema resolution', () => {
  it('imports from pi-schema', () => {
    const s = obj({ name: str(), tags: arr(str()) })
    expect(Object.keys(s.properties ?? {})).toEqual(['name', 'tags'])
  })
})
