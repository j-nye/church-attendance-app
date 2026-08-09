import { test, expect } from '@playwright/test'

test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
})

test('the settings page is not reachable without a session', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login/)
})

test('an unauthenticated POST to a protected route never reaches a Server Action', async ({ request }) => {
  // Server Actions are public POST endpoints. Without a session, this request must be
  // turned away before any action code runs.
  //
  // `maxRedirects: 0` is load-bearing. Playwright's APIRequestContext follows redirects
  // by default, which would turn the middleware's 302 into a 200 from /login and make
  // this assertion pass for entirely the wrong reason — the worst kind of security test.
  const response = await request.post('/dashboard', {
    headers: { 'Next-Action': 'invalid-action-id', 'Content-Type': 'text/plain;charset=UTF-8' },
    data: '[]',
    maxRedirects: 0,
  })

  expect(response.status()).toBeGreaterThanOrEqual(300)
  expect(response.status()).toBeLessThan(400)
  expect(response.headers()['location']).toContain('/login')
})
