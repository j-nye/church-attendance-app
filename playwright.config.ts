import { defineConfig } from '@playwright/test'
import { STORAGE_STATE_PATH } from './e2e/global-setup'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // `next start` runs in production mode, where Auth.js's trustHost only
    // defaults to true when AUTH_URL/AUTH_TRUST_HOST/VERCEL/CF_PAGES is set
    // (see node_modules/@auth/core/lib/utils/env.js). This server is never
    // actually behind Vercel or a trusted proxy — it's a bare `next start`
    // for e2e testing — so without this, every request gets a logged
    // UntrustedHost error and auth() silently behaves as if unauthenticated,
    // which only breaks tests that need a real session (the `authenticated`
    // project) rather than throwing loudly, making it easy to miss.
    env: { ...process.env, AUTH_TRUST_HOST: 'true' },
  },
  projects: [
    {
      // Exactly today's behavior: no storage state, a fresh unauthenticated
      // context for every test. Must keep passing unmodified.
      name: 'unauthenticated',
      testMatch: /auth\.spec\.ts/,
    },
    {
      // Pre-authenticated via the storage state global-setup.ts wrote.
      name: 'authenticated',
      testMatch: /counting-flow\.spec\.ts/,
      use: { storageState: STORAGE_STATE_PATH },
    },
  ],
})
