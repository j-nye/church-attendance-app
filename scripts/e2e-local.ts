import { execFileSync, spawnSync } from 'node:child_process'

/**
 * Runs e2e tests against a disposable local Postgres container instead of
 * the real Neon dev database .env.local (and direnv's Doppler export) point
 * at. Matches the project's existing decision to use a throwaway Postgres
 * for e2e rather than a Neon branch (docs/superpowers/plans/2026-08-31-roadmap.md).
 *
 * Overriding these vars only in the `env` object passed to each spawned
 * process — not via a .env file — is deliberate: direnv exports Doppler's
 * dev secrets (including the real DATABASE_URL) straight into the shell,
 * and shell-set vars always take precedence over every .env* file Next.js
 * or Prisma would otherwise read. A file-based override would silently be
 * ignored; overriding at spawn time is the only thing that actually wins.
 */
const CONTAINER_NAME = 'church-attendance-test-db'
const TEST_DB_URL = 'postgresql://postgres:postgres@localhost:5433/church_attendance_test'

const env = {
  ...process.env,
  DATABASE_URL: TEST_DB_URL,
  DIRECT_URL: TEST_DB_URL,
  AUTH_SECRET: 'local-e2e-placeholder-not-a-real-secret',
  SEED_ADMIN_EMAIL: 'e2e-admin@example.com',
  SEED_VOLUNTEER_EMAIL: 'e2e-volunteer@example.com',
  AUTH_TRUST_HOST: 'true',
}

function isContainerRunning(): boolean {
  const result = execFileSync('docker', ['ps', '-q', '-f', `name=^/${CONTAINER_NAME}$`]).toString().trim()
  return result.length > 0
}

function ensureContainer() {
  if (isContainerRunning()) {
    console.log(`Reusing running ${CONTAINER_NAME}`)
    return
  }

  console.log(`Starting disposable Postgres (${CONTAINER_NAME})...`)
  execFileSync('docker', [
    'run', '-d', '--rm',
    '--name', CONTAINER_NAME,
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=church_attendance_test',
    '-p', '5433:5432',
    'postgres:16',
  ], { stdio: 'inherit' })

  // The official postgres image restarts once internally on a fresh data
  // directory: a temp server runs init scripts, shuts down, then the real
  // server starts and logs "ready to accept connections" a second time.
  // `pg_isready` can report success against that temp server, before the
  // real one is listening — this container has no volume, so it always
  // goes through both phases, and waiting for the *second* log line is the
  // reliable signal that the real server is actually up.
  for (let attempt = 0; attempt < 30; attempt++) {
    const logs = spawnSync('docker', ['logs', CONTAINER_NAME], { encoding: 'utf8' })
    const readyCount = (
      `${logs.stdout}${logs.stderr}`.match(/database system is ready to accept connections/g) ?? []
    ).length
    if (readyCount >= 2) return
    execFileSync('sleep', ['1'])
  }
  throw new Error(`${CONTAINER_NAME} did not become ready in time`)
}

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: 'inherit', env })
}

ensureContainer()
run('npx', ['prisma', 'migrate', 'deploy'])
run('npm', ['run', 'db:seed'])
run('npx', ['playwright', 'test'])
