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
