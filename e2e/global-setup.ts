import { config } from 'dotenv'
config({ path: '.env.local' })

import path from 'node:path'
import { chromium } from '@playwright/test'
import { encode } from 'next-auth/jwt'

/**
 * The one identity this whole e2e suite signs in as — must match the
 * SEED_ADMIN_EMAIL the CI workflow (and local dev, per the plan) seeds as an
 * active ADMIN Allowlist row. Exported so the spec can assert against it if
 * ever needed, without hardcoding the string a second place.
 */
export const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'

export const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'admin-storage-state.json')

/**
 * Mints a next-auth session JWT and saves it as a Playwright storageState
 * file — never a real Google sign-in. This file is test tooling only: it is
 * never imported by anything under src/, and it adds no new code path to the
 * shipped app. The allowlist gate still applies in full on every server
 * action — this only supplies *identity* (an email), not authorization.
 *
 * AUTH_SECRET here must be the exact same value the running app (started by
 * playwright.config.ts's webServer) uses to decode sessions — both come from
 * the same process env, so in CI they're always the same step's env: block,
 * and locally both come from .env.local via the dotenv load above.
 */
export default async function globalSetup() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(
      'AUTH_SECRET must be set to mint an e2e session token (checked e2e/global-setup.ts)'
    )
  }

  const token = await encode({
    secret,
    // Must match the real, unprefixed cookie name @auth/core reads when the
    // app is served over http (baseURL is http://localhost:3000, not https)
    // — see node_modules/@auth/core/lib/utils/cookie.js's defaultCookies().
    salt: 'authjs.session-token',
    maxAge: 60 * 60 * 24 * 7, // matches src/lib/auth.ts's session.maxAge
    token: { email: E2E_ADMIN_EMAIL, sub: 'e2e-test-admin', name: 'E2E Admin' },
  })

  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addCookies([
    {
      name: 'authjs.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: false, // matches defaultCookies(useSecureCookies: false) for http://localhost
    },
  ])
  await context.storageState({ path: STORAGE_STATE_PATH })
  await browser.close()
}
