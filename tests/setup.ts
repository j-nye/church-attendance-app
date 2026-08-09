import { config } from 'dotenv'

// Loads real Neon credentials for local test runs. Silently does nothing when
// .env.local is absent (e.g. in CI), so DB-dependent tests can skip themselves.
config({ path: '.env.local' })
