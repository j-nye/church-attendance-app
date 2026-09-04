import { config } from 'dotenv'

// Loads real Neon credentials for local test runs. Silently does nothing when
// .env.local is absent (e.g. in CI), so DB-dependent tests can skip themselves.
config({ path: '.env.local' })

// tests/auth.test.ts's non-DB-gated "auth config" suite calls handlers.GET(),
// which runs Auth.js's own config assertion — it throws MissingSecret if
// AUTH_SECRET isn't set, regardless of whether any database is involved.
// Locally .env.local supplies a real one; CI's `npm test` step deliberately
// has no AUTH_SECRET (only `npm run build`/e2e get one — see tests.yml), so
// this is a safe, non-secret placeholder purely to satisfy that assertion.
// Never overrides a real value that dotenv already loaded above.
process.env.AUTH_SECRET ??= 'test-only-placeholder-not-a-real-secret'
