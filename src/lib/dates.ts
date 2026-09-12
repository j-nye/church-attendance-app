import type { Role } from '@/lib/authz' // type-only import — erased at compile time,
// keeps dates.ts's runtime import graph unchanged

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
 * Render a stored 24-hour "HH:mm" start time as a 12-hour clock string
 * ("9:30 AM"). Deliberately pure string/number arithmetic — no `Date`
 * construction and no timezone conversion, for the same reason
 * formatServiceDate anchors itself to UTC: the stored value is already
 * church-local wall-clock time, and running it through `Date` risks the
 * ambient TZ shifting it. Must produce the identical string regardless of
 * `process.env.TZ`.
 */
export function formatServiceTime(startTime: string): string {
  const [hourStr, minuteStr] = startTime.split(':')
  const hour24 = Number(hourStr)
  const period = hour24 < 12 ? 'AM' : 'PM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${minuteStr} ${period}`
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

export const SERVICE_DATE_PAST_DAYS = 14
export const SERVICE_DATE_FUTURE_DAYS = 28
/** Typo guard only — NOT enforced server-side. Admins have no server-side date
 * bound (see addService's doc comment for why); this only sets the date
 * input's min/max in the UI so a wildly wrong year is still hard to submit
 * by accident. */
export const ADMIN_SERVICE_DATE_PAST_DAYS = 730
export const ADMIN_SERVICE_DATE_FUTURE_DAYS = 365

/**
 * Pure calendar-day arithmetic on a "YYYY-MM-DD" string, in the same spirit
 * as nextSundayServiceDate — never round-trips through a real Date/timezone
 * conversion. `days` may be negative.
 */
export function shiftServiceDate(serviceDate: string, days: number): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  const asUTC = new Date(Date.UTC(year, month - 1, day))
  asUTC.setUTCDate(asUTC.getUTCDate() + days)

  const y = asUTC.getUTCFullYear()
  const m = String(asUTC.getUTCMonth() + 1).padStart(2, '0')
  const d = String(asUTC.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** The volunteer-facing rolling window. */
export function serviceDateWindow(today = todayServiceDate()): { min: string; max: string } {
  return {
    min: shiftServiceDate(today, -SERVICE_DATE_PAST_DAYS),
    max: shiftServiceDate(today, SERVICE_DATE_FUTURE_DAYS),
  }
}

/**
 * Role-conditional window: volunteers get the enforced bound above; admins
 * get the much wider typo-guard-only range. Both are pure display/hint
 * values here — the actual server-side enforcement happens in
 * addServiceSchemaByRole, not by calling this function again.
 */
export function serviceDateWindowFor(
  role: Role,
  today = todayServiceDate()
): { min: string; max: string } {
  const [pastDays, futureDays] =
    role === 'ADMIN'
      ? [ADMIN_SERVICE_DATE_PAST_DAYS, ADMIN_SERVICE_DATE_FUTURE_DAYS]
      : [SERVICE_DATE_PAST_DAYS, SERVICE_DATE_FUTURE_DAYS]
  return { min: shiftServiceDate(today, -pastDays), max: shiftServiceDate(today, futureDays) }
}
