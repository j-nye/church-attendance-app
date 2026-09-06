import { config } from 'dotenv'
config({ path: '.env.local' })

import path from 'node:path'
import { chromium } from '@playwright/test'
import { encode } from 'next-auth/jwt'

/**
 * The admin identity most of this e2e suite signs in as — must match the
 * SEED_ADMIN_EMAIL the CI workflow (and local dev, per the plan) seeds as an
 * active ADMIN Allowlist row. Exported so specs can assert against it if
 * ever needed, without hardcoding the string a second place.
 */
export const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'

/**
 * The non-admin identity e2e/authz.spec.ts signs in as, to assert the
 * VOLUNTEER/ADMIN boundary against a real page rather than a mock. Must
 * match the SEED_VOLUNTEER_EMAIL the CI workflow seeds as an active
 * VOLUNTEER Allowlist row.
 */
export const E2E_VOLUNTEER_EMAIL = 'e2e-volunteer@example.com'

export const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'admin-storage-state.json')
export const VOLUNTEER_STORAGE_STATE_PATH = path.join(
  __dirname,
  '.auth',
  'volunteer-storage-state.json'
)

/**
 * Mints a next-auth session JWT for one identity — never a real Google
 * sign-in. This file is test tooling only: it is never imported by anything
 * under src/, and it adds no new code path to the shipped app. The
 * allowlist gate still applies in full on every server action — this only
 * supplies *identity* (an email), not authorization.
 */
async function mintSessionToken(secret: string, email: string, sub: string, name: string) {
  return encode({
    secret,
    // Must match the real, unprefixed cookie name @auth/core reads when the
    // app is served over http (baseURL is http://localhost:3000, not https)
    // — see node_modules/@auth/core/lib/utils/cookie.js's defaultCookies().
    salt: 'authjs.session-token',
    maxAge: 60 * 60 * 24 * 7, // matches src/lib/auth.ts's session.maxAge
    token: { email, sub, name },
  })
}

/**
 * Writes one identity's session token into a fresh browser context's
 * cookies, then saves that as a Playwright storageState file at outPath.
 *
 * AUTH_SECRET here must be the exact same value the running app (started by
 * playwright.config.ts's webServer) uses to decode sessions — both come from
 * the same process env, so in CI they're always the same step's env: block,
 * and locally both come from .env.local via the dotenv load above.
 */
async function writeStorageState(
  browser: import('@playwright/test').Browser,
  secret: string,
  email: string,
  sub: string,
  name: string,
  outPath: string
) {
  const token = await mintSessionToken(secret, email, sub, name)
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
  await context.storageState({ path: outPath })
  await context.close()
}

export default async function globalSetup() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(
      'AUTH_SECRET must be set to mint an e2e session token (checked e2e/global-setup.ts)'
    )
  }

  const browser = await chromium.launch()
  await writeStorageState(
    browser,
    secret,
    E2E_ADMIN_EMAIL,
    'e2e-test-admin',
    'E2E Admin',
    STORAGE_STATE_PATH
  )
  await writeStorageState(
    browser,
    secret,
    E2E_VOLUNTEER_EMAIL,
    'e2e-test-volunteer',
    'E2E Volunteer',
    VOLUNTEER_STORAGE_STATE_PATH
  )
  await browser.close()
}
