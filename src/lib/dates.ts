/**
 * The church's local timezone. Every service date is derived in this zone.
 * CONFIRMED CORRECT by the plan owner on 2026-08-09 — do not change it. The
 * fixtures in tests/dates.test.ts assume this value.
 */
export const CHURCH_TIMEZONE = 'America/New_York'

/** Convert an instant to a church-local calendar date string (YYYY-MM-DD). */
export function toServiceDate(instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the storage format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Today's service date in church-local time. */
export function todayServiceDate(): string {
  return toServiceDate(new Date())
}

/** Render a stored YYYY-MM-DD for display without any timezone shifting. */
export function formatServiceDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
