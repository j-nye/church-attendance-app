import { test, expect } from '@playwright/test'

test('sign in, record a count, and see it on the report', async ({ page }) => {
  // Authenticated via the `authenticated` project's storageState (Task 2) —
  // no sign-in UI in this test; the allowlist gate still ran server-side for
  // every request below, exactly as for a real signed-in user.
  await page.goto('/dashboard')

  await page.getByRole('button', { name: /start counting today.s service/i }).click()
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
