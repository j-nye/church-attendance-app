import { test, expect } from '@playwright/test'

test('a VOLUNTEER cannot reach admin-only settings', async ({ page }) => {
  // Authenticated via the `volunteer` project's storageState (global-setup.ts)
  // as an active, allowlisted VOLUNTEER — this asserts the role boundary
  // itself, not just "no session" or "not on the allowlist" (already covered
  // by tests/authz.test.ts's unit tests against requireAdmin()).
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/denied$/)
})

test('a VOLUNTEER can add an additional service for today, and re-adding the same time resolves via the collision prompt instead of creating a duplicate', async ({
  page,
}) => {
  // A distinctive time not used by any other spec, per this project's e2e
  // convention of avoiding cross-project time collisions against the shared
  // disposable-Postgres "today" (counting-flow.spec.ts already uses
  // 09:30/11:00).
  const TIME = '19:45'
  const TIME_LABEL = '7:45 PM'

  await page.goto('/dashboard')

  // AddTodayServiceForm only renders once today already has at least one
  // service (src/app/dashboard/page.tsx renders it only when
  // todayEvents.length > 0). The `authenticated` project's
  // counting-flow.spec.ts also creates today services against this same
  // disposable-Postgres database, but Playwright gives no ordering guarantee
  // across projects/files — so bootstrap the first service ourselves via the
  // existing zero-service form when it isn't already there, rather than
  // assuming another spec file ran first.
  const addButton = page.getByRole('button', { name: '+ Add another service for today' })
  if (!(await addButton.isVisible().catch(() => false))) {
    // Zero-services state has exactly one "Start counting..." button, so this
    // can't collide with the "2+ services" per-service buttons — those only
    // exist once addButton would already be visible.
    await page.getByRole('button', { name: /start counting/i }).click()
    await expect(page).toHaveURL(/\/entry\/[^/]+$/)
    await page.goto('/dashboard')
  }

  // First add at the distinctive time: no collision possible yet, since
  // nothing else in this suite uses 19:45.
  await page.getByRole('button', { name: '+ Add another service for today' }).click()
  await page.locator('input[name="startTime"]').fill(TIME)
  await page.getByRole('button', { name: 'Add service' }).click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const firstEventId = new URL(page.url()).pathname.split('/').pop()!

  // Second add at the SAME time: must not silently create a duplicate or
  // silently route to the existing one — the collision prompt must appear
  // and let the volunteer choose.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '+ Add another service for today' }).click()
  await page.locator('input[name="startTime"]').fill(TIME)
  await page.getByRole('button', { name: 'Add service' }).click()

  await expect(page.getByRole('status')).toContainText(TIME_LABEL)

  // The assertion that actually matters: choosing "Go to <time> service"
  // routes to the SAME event created by the first add, proving the fork
  // resolves to the existing row rather than creating a second one.
  await page.getByRole('button', { name: `Go to ${TIME_LABEL} service` }).click()
  await expect(page).toHaveURL(new RegExp(`/entry/${firstEventId}$`))
})
