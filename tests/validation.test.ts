import { describe, it, expect } from 'vitest'
import {
  saveCountSchema,
  categoryTypeSchema,
  createCategorySchema,
  createEventSchema,
  allowlistEntrySchema,
  CATEGORY_NAME_MAX,
} from '@/lib/validation'

describe('saveCountSchema', () => {
  const valid = { eventId: 'clx0000000000000000000001', categoryId: 'clx0000000000000000000002', count: 42 }

  it('accepts a valid count', () => {
    expect(saveCountSchema.parse(valid)).toEqual(valid)
  })

  it('rejects negative counts', () => {
    expect(() => saveCountSchema.parse({ ...valid, count: -1 })).toThrow()
  })

  it('rejects non-integer counts', () => {
    expect(() => saveCountSchema.parse({ ...valid, count: 3.5 })).toThrow()
  })

  it('rejects absurdly large counts', () => {
    expect(() => saveCountSchema.parse({ ...valid, count: 999999999 })).toThrow()
  })

  it('rejects a missing eventId', () => {
    expect(() => saveCountSchema.parse({ categoryId: valid.categoryId, count: 1 })).toThrow()
  })
})

describe('createCategorySchema', () => {
  it('trims whitespace from the name', () => {
    const result = createCategorySchema.parse({ name: '  Balcony  ', type: 'SECTION', svgKey: null })
    expect(result.name).toBe('Balcony')
  })

  it('rejects an empty name', () => {
    expect(() => createCategorySchema.parse({ name: '   ', type: 'SECTION', svgKey: null })).toThrow()
  })

  it('rejects a name longer than the cap', () => {
    const tooLong = 'x'.repeat(CATEGORY_NAME_MAX + 1)
    expect(() => createCategorySchema.parse({ name: tooLong, type: 'SECTION', svgKey: null })).toThrow()
  })

  it('rejects an unknown category type', () => {
    expect(() => createCategorySchema.parse({ name: 'Foyer', type: 'PARKING_LOT', svgKey: null })).toThrow()
  })
})

describe('categoryTypeSchema', () => {
  it('accepts all five category types', () => {
    for (const type of ['SECTION', 'CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC']) {
      expect(categoryTypeSchema.parse(type)).toBe(type)
    }
  })
})

describe('createCategorySchema — countsTowardTotal', () => {
  it('defaults countsTowardTotal to true when omitted', () => {
    const result = createCategorySchema.parse({ name: 'Left Wing', type: 'SECTION', svgKey: null })
    expect(result.countsTowardTotal).toBe(true)
  })

  it('accepts an explicit countsTowardTotal of false', () => {
    const result = createCategorySchema.parse({
      name: 'Salvations',
      type: 'SERVICE_METRIC',
      svgKey: null,
      countsTowardTotal: false,
    })
    expect(result.countsTowardTotal).toBe(false)
  })
})

describe('createEventSchema', () => {
  it('accepts a YYYY-MM-DD service date', () => {
    const result = createEventSchema.parse({ name: 'Sunday Service - 9AM', serviceDate: '2026-08-09' })
    expect(result.serviceDate).toBe('2026-08-09')
  })

  it('rejects a timestamp masquerading as a service date', () => {
    expect(() =>
      createEventSchema.parse({ name: 'Sunday', serviceDate: '2026-08-09T13:00:00Z' })
    ).toThrow()
  })

  it('rejects an impossible calendar date', () => {
    expect(() => createEventSchema.parse({ name: 'Sunday', serviceDate: '2026-02-30' })).toThrow()
  })
})

describe('allowlistEntrySchema', () => {
  it('lowercases the email', () => {
    const result = allowlistEntrySchema.parse({ email: 'Person@Example.COM', role: 'VOLUNTEER' })
    expect(result.email).toBe('person@example.com')
  })

  it('rejects a malformed email', () => {
    expect(() => allowlistEntrySchema.parse({ email: 'not-an-email', role: 'ADMIN' })).toThrow()
  })
})
