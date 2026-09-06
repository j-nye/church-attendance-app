import { test, expect } from '@playwright/test'

test('a VOLUNTEER cannot reach admin-only settings', async ({ page }) => {
  // Authenticated via the `volunteer` project's storageState (global-setup.ts)
  // as an active, allowlisted VOLUNTEER — this asserts the role boundary
  // itself, not just "no session" or "not on the allowlist" (already covered
  // by tests/authz.test.ts's unit tests against requireAdmin()).
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/denied$/)
})
