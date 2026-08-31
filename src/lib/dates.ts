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

/**
 * The next church-local Sunday on/after `from` — today itself if today is
 * already Sunday. Defaults the "create a service" form's date field.
 *
 * Deliberately does NOT re-run the result through toServiceDate(): that
 * function applies CHURCH_TIMEZONE to an *instant*, and by this point we've
 * already resolved a calendar date and are only doing pure Y/M/D arithmetic
 * on it. Re-converting a UTC-midnight instant built from that date back
 * through CHURCH_TIMEZONE would shift it a day backward (America/New_York
 * is behind UTC) — the same trap formatServiceDate's UTC-anchored math
 * avoids by formatting with `timeZone: 'UTC'` instead of the church zone.
 */
export function nextSundayServiceDate(from: Date = new Date()): string {
  const [year, month, day] = toServiceDate(from).split('-').map(Number)
  const asUTC = new Date(Date.UTC(year, month - 1, day))
  const daysUntilSunday = (7 - asUTC.getUTCDay()) % 7 // 0 if `from`'s date is already Sunday
  asUTC.setUTCDate(asUTC.getUTCDate() + daysUntilSunday)

  const y = asUTC.getUTCFullYear()
  const m = String(asUTC.getUTCMonth() + 1).padStart(2, '0')
  const d = String(asUTC.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
