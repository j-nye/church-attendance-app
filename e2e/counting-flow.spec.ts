import { test, expect } from '@playwright/test'

test('sign in, record a count, and see it on the report', async ({ page }) => {
  // Authenticated via the `authenticated` project's storageState (Task 2) —
  // no sign-in UI in this test; the allowlist gate still ran server-side for
  // every request below, exactly as for a real signed-in user.
  await page.goto('/dashboard')

  // Zero-or-one-service case: the dashboard keeps a single "Start counting"
  // button, labelled with a time once a service exists for today (Task 1.4).
  // Match loosely on "Start counting" so this passes whether today has zero
  // services (button still reads "...today's service") or exactly one
  // (button reads "Start counting — 9:30 AM").
  await page.getByRole('button', { name: /start counting/i }).click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const eventId = new URL(page.url()).pathname.split('/').pop()!

  // Left Wing: a real seeded Sanctuary section (prisma/seed.ts's
  // DEFAULT_CATEGORIES), rendered by SanctuaryMap as an accessible button
  // labelled "Left Wing, count <n>".
  await page.getByRole('button', { name: /^Left Wing,/i }).click()

  const dialog = page.getByRole('dialog', { name: 'Count for Left Wing' })
  await expect(dialog).toBeVisible()
  // +10 three times + +1 once = 31 — a specific, non-zero, easy-to-verify number.
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: 'Increase count' }).click()
  await expect(dialog.getByRole('status')).toHaveText('31')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  await page.goto(`/report/${eventId}`)

  const leftWingRow = page.locator('tr', { hasText: 'Left Wing' })
  await expect(leftWingRow.locator('td').nth(1)).toHaveText('31')

  const totalRow = page.locator('tr', { hasText: 'Total' })
  await expect(totalRow.locator('td').nth(1)).toHaveText('31')
})

test('two services on the same date route to separate entry screens with separate counts', async ({ page }) => {
  // This is the regression test for the exact bug Task 1.4 fixes: before,
  // getOrCreateTodayEvent resolved today's service with
  // findFirst(orderBy: name), so a date with two services could silently
  // route a volunteer into the wrong one and — because counts are
  // upserted — overwrite that service's numbers. Asserting only that two
  // buttons render would pass even if both routed to the same event; the
  // assertion that matters is the one at the bottom confirming the two
  // services' reports stay independent.
  //
  // NOTE: this test depends on Task 1.5 (a separate, not-yet-implemented
  // task in the same plan) adding a `startTime` <input type="time"> to the
  // "Create a service" form in src/components/ServicesSection.tsx. Until
  // that field exists, submitting the create form below fails
  // createEventSchema's now-required startTime and this test cannot pass.
  // It is written now, against the UI Task 1.5 specifies, per this plan's
  // Verification section — it will start passing once Task 1.5 lands.
  //
  // Uses the same church-local calendar-date derivation as
  // src/lib/dates.ts's toServiceDate(), inlined here rather than imported
  // so this spec has no dependency on the app's module resolution.
  const todayServiceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  async function createService(name: string, time: string) {
    await page.getByPlaceholder('Service name').fill(name)
    await page.locator('input[name="serviceDate"]').fill(todayServiceDate)
    await page.locator('input[name="startTime"]').fill(time)
    await page.getByRole('button', { name: 'Create service' }).click()
    await expect(page.getByText(name, { exact: false })).toBeVisible()
  }

  await page.goto('/settings')
  await createService('Early Service E2E', '09:30')
  await createService('Late Service E2E', '11:00')

  await page.goto('/dashboard')

  // No single "Start counting today's service" button once there's more
  // than one service today, and no default selection — one time-labelled
  // button per service instead.
  await expect(
    page.getByRole('button', { name: /start counting today.s service/i })
  ).toHaveCount(0)
  const earlyButton = page.getByRole('button', { name: /9:30 AM/i })
  const lateButton = page.getByRole('button', { name: /11:00 AM/i })
  await expect(earlyButton).toBeVisible()
  await expect(lateButton).toBeVisible()

  await earlyButton.click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const earlyEventId = new URL(page.url()).pathname.split('/').pop()!

  await page.getByRole('button', { name: /^Left Wing,/i }).click()
  const earlyDialog = page.getByRole('dialog', { name: 'Count for Left Wing' })
  await earlyDialog.getByRole('button', { name: '+10' }).click()
  await expect(earlyDialog.getByRole('status')).toHaveText('10')
  await earlyDialog.getByRole('button', { name: 'Save' }).click()
  await expect(earlyDialog).not.toBeVisible()

  await page.goto('/dashboard')
  await page.getByRole('button', { name: /11:00 AM/i }).click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const lateEventId = new URL(page.url()).pathname.split('/').pop()!
  expect(lateEventId).not.toBe(earlyEventId)

  await page.getByRole('button', { name: /^Left Wing,/i }).click()
  const lateDialog = page.getByRole('dialog', { name: 'Count for Left Wing' })
  await lateDialog.getByRole('button', { name: '+10' }).click()
  await lateDialog.getByRole('button', { name: '+10' }).click()
  await expect(lateDialog.getByRole('status')).toHaveText('20')
  await lateDialog.getByRole('button', { name: 'Save' }).click()
  await expect(lateDialog).not.toBeVisible()

  // The assertion that actually matters: counts entered into one service do
  // not appear on the other's report.
  await page.goto(`/report/${earlyEventId}`)
  const earlyRow = page.locator('tr', { hasText: 'Left Wing' })
  await expect(earlyRow.locator('td').nth(1)).toHaveText('10')

  await page.goto(`/report/${lateEventId}`)
  const lateRow = page.locator('tr', { hasText: 'Left Wing' })
  await expect(lateRow.locator('td').nth(1)).toHaveText('20')
})
