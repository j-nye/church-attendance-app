import { describe, it, expect } from 'vitest'
import {
  saveCountSchema,
  deleteCountSchema,
  addSpeakerSchema,
  removeSpeakerSchema,
  categoryTypeSchema,
  createCategorySchema,
  createEventSchema,
  allowlistEntrySchema,
  friendlyValidationMessage,
  CATEGORY_NAME_MAX,
  serviceDateSchema,
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

describe('deleteCountSchema', () => {
  const valid = { eventId: 'clx0000000000000000000001', categoryId: 'clx0000000000000000000002' }

  it('accepts a valid eventId/categoryId pair', () => {
    expect(deleteCountSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a missing categoryId', () => {
    expect(() => deleteCountSchema.parse({ eventId: valid.eventId })).toThrow()
  })

  it('rejects an empty eventId', () => {
    expect(() => deleteCountSchema.parse({ ...valid, eventId: '' })).toThrow()
  })
})

describe('addSpeakerSchema', () => {
  const valid = { eventId: 'clx0000000000000000000001', name: 'Pastor Jones' }

  it('accepts a valid eventId/name pair', () => {
    expect(addSpeakerSchema.parse(valid)).toEqual(valid)
  })

  it('trims whitespace from the name', () => {
    const result = addSpeakerSchema.parse({ ...valid, name: '  Pastor Jones  ' })
    expect(result.name).toBe('Pastor Jones')
  })

  it('rejects an empty name', () => {
    expect(() => addSpeakerSchema.parse({ ...valid, name: '' })).toThrow()
  })

  it('rejects a whitespace-only name', () => {
    expect(() => addSpeakerSchema.parse({ ...valid, name: '   ' })).toThrow()
  })

  it('rejects a name longer than 80 characters', () => {
    expect(() => addSpeakerSchema.parse({ ...valid, name: 'x'.repeat(81) })).toThrow()
  })

  it('accepts a name at exactly the 80-character cap', () => {
    const name = 'x'.repeat(80)
    expect(addSpeakerSchema.parse({ ...valid, name }).name).toBe(name)
  })

  it('rejects a missing eventId', () => {
    expect(() => addSpeakerSchema.parse({ name: valid.name })).toThrow()
  })
})

describe('removeSpeakerSchema', () => {
  const valid = { eventId: 'clx0000000000000000000001', speakerId: 'clx0000000000000000000002' }

  it('accepts a valid eventId/speakerId pair', () => {
    expect(removeSpeakerSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a missing speakerId', () => {
    expect(() => removeSpeakerSchema.parse({ eventId: valid.eventId })).toThrow()
  })

  it('rejects an empty eventId', () => {
    expect(() => removeSpeakerSchema.parse({ ...valid, eventId: '' })).toThrow()
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

describe('serviceDateSchema', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(serviceDateSchema.parse('2026-08-16')).toBe('2026-08-16')
  })

  it('rejects a non-calendar date', () => {
    expect(() => serviceDateSchema.parse('2026-02-30')).toThrow()
  })

  it('rejects a timestamp', () => {
    expect(() => serviceDateSchema.parse('2026-08-16T00:00:00Z')).toThrow()
  })
})

describe('friendlyValidationMessage', () => {
  it('reports a blank required field by name, not Zod\'s raw wording', () => {
    const { error } = createCategorySchema.safeParse({ name: '', type: 'SECTION' })
    expect(friendlyValidationMessage(error!)).toBe('Name is required.')
  })

  it('reports an invalid enum value by field name', () => {
    const { error } = createCategorySchema.safeParse({ name: 'Nursery', type: 'BOGUS' })
    expect(friendlyValidationMessage(error!)).toBe('Category type must be one of the listed options.')
  })

  it('reports a malformed email as an email problem', () => {
    const { error } = allowlistEntrySchema.safeParse({ email: 'not-an-email', role: 'ADMIN' })
    expect(friendlyValidationMessage(error!)).toBe("Email address doesn't look like a valid email address.")
  })

  it('reports an over-length email as too long', () => {
    const { error } = allowlistEntrySchema.safeParse({ email: `${'x'.repeat(300)}@example.com`, role: 'ADMIN' })
    expect(friendlyValidationMessage(error!)).toBe('Email address is too long.')
  })

  it('falls back to a generic message for a field it does not recognize', () => {
    const { error } = saveCountSchema.safeParse({ categoryId: 'c1', count: 1 }) // eventId missing entirely
    expect(friendlyValidationMessage(error!)).toBe('That field is required.')
  })
})
