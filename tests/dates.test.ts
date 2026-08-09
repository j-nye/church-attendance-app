import { describe, it, expect } from 'vitest'
import { toServiceDate, formatServiceDate, CHURCH_TIMEZONE } from '@/lib/dates'

describe('toServiceDate', () => {
  it('uses the church timezone, not UTC', () => {
    // 2026-08-10T01:30Z is still Sunday 2026-08-09, 9:30pm in New York.
    expect(toServiceDate(new Date('2026-08-10T01:30:00Z'))).toBe('2026-08-09')
  })

  it('handles a Sunday morning service correctly', () => {
    // 9:00am Eastern on Sunday 2026-08-09 is 13:00Z the same day.
    expect(toServiceDate(new Date('2026-08-09T13:00:00Z'))).toBe('2026-08-09')
  })

  it('rolls over at church-local midnight, not UTC midnight', () => {
    // 2026-08-09T04:30Z is 12:30am Eastern on 2026-08-09.
    expect(toServiceDate(new Date('2026-08-09T04:30:00Z'))).toBe('2026-08-09')
    // 2026-08-09T03:30Z is 11:30pm Eastern on 2026-08-08.
    expect(toServiceDate(new Date('2026-08-09T03:30:00Z'))).toBe('2026-08-08')
  })
})

describe('formatServiceDate', () => {
  it('renders a human-readable date without shifting the day', () => {
    expect(formatServiceDate('2026-08-09')).toBe('Sunday, August 9, 2026')
  })
})

describe('CHURCH_TIMEZONE', () => {
  it('is a valid IANA zone', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: CHURCH_TIMEZONE })).not.toThrow()
  })
})
