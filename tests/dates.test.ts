import { describe, it, expect } from 'vitest'
import { toServiceDate, formatServiceDate, nextSundayServiceDate, CHURCH_TIMEZONE } from '@/lib/dates'

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

describe('nextSundayServiceDate', () => {
  it('returns the same date when today is already a Sunday', () => {
    // 2026-08-09T13:00:00Z is 9am Eastern on Sunday 2026-08-09 (per the toServiceDate fixture above).
    expect(nextSundayServiceDate(new Date('2026-08-09T13:00:00Z'))).toBe('2026-08-09')
  })

  it('returns the upcoming Sunday when today is a weekday', () => {
    // 2026-08-31 is a Monday; the next Sunday is 2026-09-06.
    expect(nextSundayServiceDate(new Date('2026-08-31T13:00:00Z'))).toBe('2026-09-06')
  })

  it('returns the upcoming Sunday when today is a Saturday', () => {
    // 2026-08-15 is a Saturday; the next Sunday is 2026-08-16.
    expect(nextSundayServiceDate(new Date('2026-08-15T13:00:00Z'))).toBe('2026-08-16')
  })

  it('rolls over at church-local midnight like toServiceDate does', () => {
    // 2026-08-09T03:30Z is 11:30pm Eastern on Saturday 2026-08-08 — the
    // church-local day hasn't rolled to Sunday yet, so the next Sunday is
    // still tomorrow (2026-08-09), not today.
    expect(nextSundayServiceDate(new Date('2026-08-09T03:30:00Z'))).toBe('2026-08-09')
  })

  it('defaults to now when no instant is passed', () => {
    expect(() => nextSundayServiceDate()).not.toThrow()
    expect(nextSundayServiceDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('CHURCH_TIMEZONE', () => {
  it('is a valid IANA zone', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: CHURCH_TIMEZONE })).not.toThrow()
  })
})
