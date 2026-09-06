import { config } from 'dotenv'
config({ path: '.env.local' })

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { encode } from 'next-auth/jwt'

/**
 * Authenticated, local-only DAST. Mints a next-auth session the same way
 * e2e/global-setup.ts does — via next-auth/jwt's encode(), never a real
 * Google sign-in — so Nuclei scans past the login wall instead of just
 * hitting /login. See AGENTS.md's "Security Scanning" section for why this
 * is deliberately scoped to static pages and to misconfig/exposure tags
 * only, and why it isn't wired into CI.
 */
async function main() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET must be set to mint a scan session (checked scripts/security/dast.ts)')
  }

  const token = await encode({
    secret,
    salt: 'authjs.session-token',
    maxAge: 60 * 60,
    token: {
      email: process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() ?? 'e2e-admin@example.com',
      sub: 'nuclei-scan',
      name: 'Nuclei Scan',
    },
  })

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const targetsFile = path.join(scriptDir, 'dast-targets.txt')

  execFileSync(
    'nuclei',
    [
      '-l', targetsFile,
      '-H', `Cookie: authjs.session-token=${token}`,
      '-tags', 'misconfig,exposure',
      '-severity', 'low,medium,high,critical',
      '-rl', '50',
      '-json-export', 'nuclei-results.json',
    ],
    { stdio: 'inherit' }
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
