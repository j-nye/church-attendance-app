import { test, expect } from '@playwright/test'

test('a VOLUNTEER cannot reach admin-only settings', async ({ page }) => {
  // Authenticated via the `volunteer` project's storageState (global-setup.ts)
  // as an active, allowlisted VOLUNTEER — this asserts the role boundary
  // itself, not just "no session" or "not on the allowlist" (already covered
  // by tests/authz.test.ts's unit tests against requireAdmin()).
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/denied$/)
})

test('a VOLUNTEER can add a service, and re-adding the same date/time resolves via the collision prompt instead of creating a duplicate', async ({
  page,
}) => {
  // A distinctive time not used by any other spec, per this project's e2e
  // convention of avoiding cross-project time collisions against the shared
  // disposable-Postgres "today" (counting-flow.spec.ts uses
  // 09:30/11:00/14:15/15:30; this file previously used 19:45).
  const TIME = '20:15'
  const TIME_LABEL = '8:15 PM'

  await page.goto('/dashboard')

  // AddServiceForm is now rendered unconditionally (no more
  // todayEvents.length > 0 gate — a volunteer can add a service even on a
  // cold dashboard with zero services today), so there's no bootstrap step
  // needed before opening it.
  // Date field is left at its default (today) — this test is only exercising
  // the time-collision fork, not the new date-picking behavior.
  await page.getByRole('button', { name: '+ Add a service' }).click()
  await page.locator('input[name="startTime"]').fill(TIME)
  await page.getByRole('button', { name: 'Add service' }).click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const firstEventId = new URL(page.url()).pathname.split('/').pop()!

  // Second add at the SAME date/time: must not silently create a duplicate
  // or silently route to the existing one — the collision prompt must
  // appear and let the volunteer choose.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '+ Add a service' }).click()
  await page.locator('input[name="startTime"]').fill(TIME)
  await page.getByRole('button', { name: 'Add service' }).click()

  await expect(page.getByRole('status')).toContainText(TIME_LABEL)

  // The assertion that actually matters: choosing "Go to <time> service"
  // routes to the SAME event created by the first add, proving the fork
  // resolves to the existing row rather than creating a second one.
  await page.getByRole('button', { name: `Go to ${TIME_LABEL} service` }).click()
  await expect(page).toHaveURL(new RegExp(`/entry/${firstEventId}$`))
})

test('a VOLUNTEER is refused a serviceDate outside the allowed window, with no service created', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '+ Add a service' }).click()

  // Comfortably outside SERVICE_DATE_FUTURE_DAYS (28) in either direction —
  // this doesn't need to be a boundary-precision test, just clearly beyond
  // the volunteer window, to prove the server-side bound (not just the
  // client min/max hint) is what's actually stopping this.
  const farFuture = new Date()
  farFuture.setUTCDate(farFuture.getUTCDate() + 400)
  const y = farFuture.getUTCFullYear()
  const m = String(farFuture.getUTCMonth() + 1).padStart(2, '0')
  const d = String(farFuture.getUTCDate()).padStart(2, '0')
  const farFutureDate = `${y}-${m}-${d}`

  await page.locator('input[name="serviceDate"]').fill(farFutureDate)
  await page.locator('input[name="startTime"]').fill('16:40')
  await page.getByRole('button', { name: 'Add service' }).click()

  // Scoped to the <p role="alert"> AddServiceForm renders — a bare
  // getByRole('alert') also matches Next.js's route-announcer div
  // (#__next-route-announcer__, present on every page), which is a strict-
  // mode violation.
  await expect(page.locator('p[role="alert"]')).toContainText(/too far out/i)
  // Refused inline, not routed anywhere — still on the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/)
})
