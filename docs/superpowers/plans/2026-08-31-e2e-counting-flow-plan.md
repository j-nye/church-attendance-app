# E2E Counting-Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is CI/test infrastructure, not application code.** Almost none of these tasks have a Vitest red/green cycle — there is no unit under test, just config files and one Playwright spec. Each task states explicitly how it's actually verified: reading the generated config, a type-check, a syntax dry-run, a standalone script exercising the one risky primitive in isolation, or — where nothing short of a real CI run proves the thing — deferring to what Task 4 describes running the job looks like. **No task in this plan runs `npm run dev`, `npm run build`, `npm run test:e2e`, or otherwise touches port 3000** — a dev server for manual testing is already running there throughout implementation.

**Status:** Ready for implementation.

**Goal:** Close the gap AGENTS.md names explicitly — "Counting logic (saveCount, getEventCounts) has only unit tests. E2E coverage is thin" — by adding the one missing high-risk flow (sign in → record a count → verify it on the report) to CI, without ever touching a real Google OAuth screen and without weakening the existing unauthenticated e2e coverage.

**Architecture:**
1. `.github/workflows/tests.yml` gains a `postgres:16` service container on the `test` job, plus two new steps (`prisma migrate deploy`, `npm run db:seed`) that run after `npm ci` and before the e2e step. Real `DATABASE_URL`/`DIRECT_URL` values are added **only** as step-level `env:` on the migrate/seed/e2e steps — never at the job level — so `npm test` keeps running with no `DATABASE_URL` at all and its live-DB suites (`tests/seed.test.ts`, `tests/auth.test.ts`, `tests/prisma-schema.test.ts`) keep skipping exactly as today, unaffected by the service container running alongside it.
2. `playwright.config.ts` gains a `globalSetup` (a new `e2e/global-setup.ts`) and a `projects` array: one project (`unauthenticated`) matching the existing `e2e/auth.spec.ts` with no `storageState` — behaviorally identical to today — and one project (`authenticated`) matching the new `e2e/counting-flow.spec.ts` with `use: { storageState }` pointing at the file `global-setup.ts` writes. A `projects` array is chosen over per-test `test.use({ storageState })` because it keeps the two trust levels declaratively separate at the config level — a future authenticated spec is opted in by matching the project's glob, not by remembering to add a `test.use()` line to every new file.
3. `e2e/global-setup.ts` mints a next-auth session JWT via `encode()` from `next-auth/jwt` (confirmed, by direct import and execution during the writing of this plan, to round-trip correctly with this repo's installed `next-auth@5.0.0-beta.32` / `@auth/core` — see Task 2), sets it as a real browser cookie named `authjs.session-token`, and saves that as a Playwright storageState file. This file lives **only** under `e2e/`, is never imported by anything under `src/`, and adds no new code path to the shipped application — the security posture the spec calls "load-bearing" stays entirely intact.
4. `e2e/counting-flow.spec.ts` runs one flow end-to-end using that authenticated storage state: dashboard → start today's service → tap a real seeded Sanctuary section (**Left Wing**, `svgKey: 'left-wing'`) → enter a count via `CounterDialog` → navigate to the report → assert the row and the grand total.

**Tech Stack:** GitHub Actions (`services:` container), Playwright 1.62, `next-auth@5.0.0-beta.32` / `@auth/core`'s `next-auth/jwt` submodule, Prisma 6 (`migrate deploy`, not `migrate dev`), the existing `prisma/seed.ts` (unmodified).

**Spec:** `docs/superpowers/specs/2026-08-31-e2e-counting-flow-design.md`.

## Global Constraints

- No change to `src/lib/auth.ts`, `src/middleware.ts`, or `src/lib/authz.ts`. The minted token supplies identity only; `requireUser()`/`requireAdmin()` still re-check the seeded `Allowlist` row on every server action, exactly as for a real sign-in.
- No new `docker-compose.yml`. The CI service-container block plus a one-line local `docker run` note (in this plan, Task 1) are the whole local-dev story per the spec's non-goals.
- `e2e/auth.spec.ts` is **not modified** and must keep running with no storage state.
- The `npm test` step's `env:` block is untouched — it must never see `DATABASE_URL`, even though a real, reachable Postgres container is running alongside it in the same job (see Task 1's "judgment call" note — the two are independent because Vitest's `hasDatabase` gate reads `process.env.DATABASE_URL`, which step-scoped `env:` never populates for that step, regardless of what services are reachable on the runner's network).
- `npm run db:migrate` (`prisma migrate dev`) is a **local development command and stays that way** — it needs an interactive shadow database and is never appropriate for CI. The new CI step uses `npx prisma migrate deploy` directly (not through an npm script, since no script wraps it today), which only replays existing migration files against the target database — no shadow DB, no schema-drift prompts, safe for an ephemeral CI database.
- `prisma/seed.ts` is reused unmodified, invoked the same way local dev invokes it (`npm run db:seed`, i.e. `prisma db seed`, i.e. `tsx prisma/seed.ts`), with `SEED_ADMIN_EMAIL` set to the fixed test address `e2e-admin@example.com`.
- The storage-state file `e2e/global-setup.ts` writes is a generated artifact (it embeds a live, secret-signed session token) and must never be committed — it's added to `.gitignore` in Task 2.

---

### Task 1: CI workflow — Postgres service container + migrate/seed steps

**Files:**
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Produces: a reachable `localhost:5432` Postgres instance, migrated and seeded, available to the (modified in Task 3) e2e step's `env:` block.
- Consumes: `prisma/seed.ts`'s existing `SEED_ADMIN_EMAIL` contract (confirmed by reading the file: it throws if unset, upserts one `ADMIN` Allowlist row, then calls `seedCategories()`, which retires `RETIRED_CATEGORIES` and upserts all 23 `DEFAULT_CATEGORIES` — including `{ name: 'Left Wing', type: SECTION, svgKey: 'left-wing' }`, the row Task 3's spec taps).

No red/green test cycle — this is YAML. Verified by: (a) a YAML-syntax dry-run (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/tests.yml'))"` — confirmed `pyyaml` is available in this environment), (b) reading the diff back to confirm the `services:` block and step placement match GitHub Actions' documented `postgres:16` service-container pattern, and (c) true end-to-end proof is deferred to what Task 4 describes a green CI run looks like — this environment cannot execute a GitHub Actions runner.

- [x] **Step 1: Add the `postgres:16` service container to the `test` job**

In `.github/workflows/tests.yml`, add a `services:` block to the `test` job (as a sibling of `runs-on:`, before `steps:`):

```yaml
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: church_attendance_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
```

GitHub Actions runs service containers on the same Docker network as the job's steps and publishes the mapped port back to the runner's own `localhost` — so `localhost:5432` is reachable from every step in this job without any extra networking config. The health check means GitHub Actions won't hand control to the first step until `pg_isready` succeeds inside the container, so the migrate step below never races an unready Postgres.

- [x] **Step 2: Add the migrate + seed steps, after `npm ci` and before the e2e step**

Insert two new steps between the existing `- run: npm run build` step and the existing `Install Playwright browsers` step:

```yaml
      - name: Apply database migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
          DIRECT_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
      - name: Seed the database
        run: npm run db:seed
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
          DIRECT_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
          SEED_ADMIN_EMAIL: e2e-admin@example.com
```

`DATABASE_URL` and `DIRECT_URL` are identical here (unlike the real Neon setup, which splits pooled vs. direct connections) because a plain `postgres:16` container has no connection pooler in front of it — both env vars can point at the same `localhost:5432`.

- [x] **Step 3: Point the e2e step's env at the real database**

Change the existing `Run end-to-end tests` step's `env:` block from the current fake placeholder to the real container address, and add `SEED_ADMIN_EMAIL` (used by the new global-setup script — see Task 2 — to know which allowlisted identity to mint a token for):

```yaml
      - name: Run end-to-end tests
        run: npm run test:e2e
        env:
          AUTH_SECRET: ci-e2e-placeholder-not-a-real-secret
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
          DIRECT_URL: postgresql://postgres:postgres@localhost:5432/church_attendance_test
          SEED_ADMIN_EMAIL: e2e-admin@example.com
```

`AUTH_SECRET` keeps its existing placeholder value — it was already present for the (currently unused) `npm run build` inside `test:e2e`'s `webServer`, and now doubles as the secret `global-setup.ts` uses to mint the token, and the secret the running app uses to decode it. Both sides of that handshake are the same process's env, so they always match.

**Do not** touch the `npm test` step (leave it exactly as-is, no `env:` block at all) or the earlier `npm run build` step (its placeholder `DATABASE_URL` is untouched — Next's build never queries the database, so this was already safe and stays that way).

- [x] **Step 4: Judgment call — confirm `npm test` truly stays unaffected**

This is a judgment call the spec asked to be reported, not silently resolved: **is it safe that a real, reachable Postgres container is running for the *entire* job while `npm test` executes?**

Read `tests/db-probe.ts`, `tests/seed.test.ts`, `tests/auth.test.ts`, and `tests/prisma-schema.test.ts` (already done while writing this plan): each live-DB suite gates on `Boolean(process.env.DATABASE_URL) && isDatabaseReachable(process.env.DATABASE_URL!)`. Because Step 2/3 above add `DATABASE_URL` only as **step-level** `env:` on the migrate/seed/e2e steps — never at the job level — the `npm test` step's own environment has no `DATABASE_URL` key at all, regardless of whether the postgres service container is reachable on the runner's network. `Boolean(undefined)` short-circuits `hasDatabase` to `false` before the reachability probe even runs. **Verdict: safe, by construction** — this isn't a "some risk but acceptable" call, the two are structurally independent as long as Step 2/3's `env:` blocks stay step-scoped and nobody later "simplifies" this by hoisting `DATABASE_URL` to job level.

No code change in this step — it's a verification note. If a future editor ever moves `DATABASE_URL` to job-level `env:`, that would silently turn the three live-DB suites on inside `npm test`, running them against a database that (at that point in the job, before Step 2 has run) doesn't even have the schema migrated yet — they'd fail hard, not skip. Flagging this explicitly so nobody makes that "simplification" by accident.

- [x] **Step 5: Local developer story (documentation only, no new file)**

Note here, for whoever next reads this plan, the one-liner a contributor runs locally to reproduce this same setup (per the spec's "no `docker-compose.yml`" non-goal):

```bash
docker run --rm -d --name church-attendance-test-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=church_attendance_test \
  -p 5432:5432 postgres:16

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/church_attendance_test \
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/church_attendance_test \
  npx prisma migrate deploy

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/church_attendance_test \
SEED_ADMIN_EMAIL=e2e-admin@example.com \
  npm run db:seed

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/church_attendance_test \
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/church_attendance_test \
AUTH_SECRET=<any local value — must match whatever the built app will use to decode the session> \
SEED_ADMIN_EMAIL=e2e-admin@example.com \
  npm run test:e2e
```

This is not something to run as part of *this* implementation task (it would build and start a server on port 3000, colliding with the dev server already running there for manual testing) — it's the reference a contributor uses later.

- [x] **Step 6: Dry-run the YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/tests.yml')); print('valid YAML')"
```

Expected: `valid YAML`. This only proves syntax, not GitHub Actions semantics — re-read the diff against this task's Steps 1–3 to confirm the `services:` block and step placement match.

- [x] **Step 7: Commit**

```bash
git add .github/workflows/tests.yml
git commit -m "ci: add a Postgres service container and migrate/seed steps for e2e"
```

---

### Task 2: Playwright global setup — mint a session without touching Google

**Files:**
- Create: `e2e/global-setup.ts`
- Modify: `playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `encode` from `next-auth/jwt` (confirmed present — `next-auth@5.0.0-beta.32`'s `jwt.js` re-exports `@auth/core/jwt` in full, and `@auth/core/jwt.d.ts` confirms `encode<Payload = JWT>(params: JWTEncodeParams<Payload>): Promise<string>` where `JWTEncodeParams = { maxAge?: number; salt: string; secret: string | string[]; token?: Payload }`). Consumes `chromium` from `@playwright/test` to drive a throwaway browser context. Consumes `dotenv`'s `config()`, matching the exact pattern already used in `tests/setup.ts` (loads `.env.local` for local runs; silently does nothing when the file is absent, i.e. in CI).
- Produces: `e2e/.auth/admin-storage-state.json` (gitignored), consumed by `playwright.config.ts`'s new `authenticated` project (Task 2 Step 3), which Task 3's spec runs under.

No red/green cycle. Verified by: (a) `npx tsc --noEmit` (the repo's `tsconfig.json` `include` is `**/*.ts` with no exclusion for `e2e/`, so this new file is type-checked for free), (b) a standalone dry-run of the one genuinely risky primitive — `encode()`/`decode()` round-tripping against this repo's actual installed `next-auth`/`@auth/core` — already executed once while writing this plan (see the note below; the implementer should re-run it to confirm for themselves), and (c) true behavioral verification (does the app actually accept this cookie as a valid session) is deferred to Task 4's description of what a passing CI run looks like, since exercising it for real means starting the built app on port 3000, which this implementation must not do while the dev server is running there for manual testing.

- [x] **Step 1: Confirm the `encode()`/`decode()` contract against the real installed package**

This was done once already while researching this plan, and produced a clean round-trip. Re-confirm it before wiring the real file, using a **throwaway script deleted immediately after**, so nothing beyond the plan file is left behind:

```bash
cat > .scratch-verify-jwt.ts <<'EOF'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { encode, decode } from 'next-auth/jwt'

async function main() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('no AUTH_SECRET')
  const token = await encode({
    secret,
    salt: 'authjs.session-token',
    maxAge: 60 * 60 * 24 * 7,
    token: { email: 'e2e-admin@example.com', sub: 'e2e-test-admin', name: 'E2E Admin' },
  })
  console.log('encoded length:', token.length)
  const decoded = await decode({ secret, salt: 'authjs.session-token', token })
  console.log('decoded:', JSON.stringify(decoded))
}
main().catch((e) => { console.error('FAILED', e); process.exit(1) })
EOF
npx tsx .scratch-verify-jwt.ts
rm .scratch-verify-jwt.ts
```

Expected (this exact shape was observed when run during plan-writing): `encoded length: <a number>` followed by `decoded: {"email":"e2e-admin@example.com","sub":"e2e-test-admin","name":"E2E Admin","iat":...,"exp":...,"jti":"..."}`. This confirms `salt: 'authjs.session-token'` is exactly right — cross-checked against `node_modules/@auth/core/lib/actions/session.js`, which computes `const salt = options.cookies.sessionToken.name` when decoding a real request's cookie, and `node_modules/@auth/core/lib/utils/cookie.js`'s `defaultCookies(useSecureCookies)` returns `sessionToken.name = 'authjs.session-token'` (no `__Secure-` prefix) whenever `useSecureCookies` is false — which it is here, since `playwright.config.ts`'s `baseURL` is `http://localhost:3000`, not https.

Also confirms (by reading `session.js` alongside this) that when the app later decodes this token to build a session, it calls `callbacks.jwt({ token: payload, session: undefined })` with **no `profile`** — so `jwtCallback` in `src/lib/auth.ts` (`if (profile?.email) token.email = ...`) takes its early-exit branch and passes `token` through unchanged, meaning our minted `token.email` survives untouched into `sessionCallback`, which is exactly what makes `session.user.email` come out right. This is why the minted token must set `email` directly rather than relying on any callback to derive it.

`git status --short` must show nothing after `rm` — confirm before moving on.

- [x] **Step 2: Create `e2e/global-setup.ts`**

```ts
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
```

- [x] **Step 3: Wire `globalSetup` and add the `projects` array to `playwright.config.ts`**

Replace the full contents of `playwright.config.ts`:

```ts
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
```

Confirmed via Context7 (Playwright 1.61 docs, `packages/playwright/src/runner/tasks.ts`) that `createGlobalSetupTasks` places plugin setup — which is what starts `webServer` — **before** the `globalSetup` task in the runner's task list, so the server is already listening at `http://localhost:3000` by the time `global-setup.ts` opens its browser context. No race to guard against.

- [x] **Step 4: Gitignore the generated storage-state file**

Add to `.gitignore` (a new line, anywhere in the file — e.g. under the existing `# testing` section):

```
/e2e/.auth/
```

This directory contains a live, secret-signed session token whenever a developer runs the suite locally — it must never be committed.

- [x] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean. This is the primary verification for this task — it confirms `e2e/global-setup.ts` type-checks against the real `next-auth/jwt` and `@playwright/test` type definitions (not just against what this plan assumed while being written), and that `playwright.config.ts`'s new import of `STORAGE_STATE_PATH` resolves.

- [x] **Step 6: Confirm `git status --short` shows only the intended files**

```bash
git status --short
```

Expected: `e2e/global-setup.ts` (new), `playwright.config.ts` (modified), `.gitignore` (modified) — nothing under `e2e/.auth/` (it doesn't exist yet; it's only created the first time `test:e2e` actually runs, which this task does not do).

- [x] **Step 7: Commit**

```bash
git add e2e/global-setup.ts playwright.config.ts .gitignore
git commit -m "test: mint an e2e session via next-auth/jwt instead of a real Google sign-in"
```

---

### Task 3: `e2e/counting-flow.spec.ts` — sign-in → count → verify-on-report

**Files:**
- Create: `e2e/counting-flow.spec.ts`

**Interfaces:**
- Consumes: the `authenticated` Playwright project from Task 2 (via `testMatch`, no per-test `test.use()` needed). Consumes the seeded `Left Wing` Sanctuary category (`SECTION`, `svgKey: 'left-wing'`, confirmed present in `prisma/seed.ts`'s `DEFAULT_CATEGORIES`). Consumes `SanctuaryMap`'s accessible shape (confirmed by reading `src/components/SanctuaryMap.tsx`): each sanctuary region renders as `<g role="button" aria-label="{categoryName}, count {count ?? 0}">`, so `page.getByRole('button', { name: /^Left Wing,/i })` is a real, stable Playwright locator — not a CSS/DOM-structure guess. Consumes `CounterDialog`'s accessible shape (confirmed by reading `src/components/CounterDialog.tsx`): `role="dialog"` with `aria-label="Count for {categoryName}"`, a `+10` bump button, and a `Save` button. Consumes the report page's row/total shape (confirmed by reading `src/app/report/[eventId]/page.tsx`): each category renders as a plain `<tr><td>{name}</td><td>{count}</td></tr>`, and the grand total as a `<tr><td>Total</td><td>{totals.grand}</td></tr>` — since this is a freshly created event with only one recorded category, `totals.grand` equals exactly the count entered for Left Wing (it sums only `countsTowardTotal` records, and Left Wing is the only one recorded).

No red/green cycle — this is the one new integration point this whole plan exists to add. Verified by: (a) `npx tsc --noEmit` (type-checks against real Playwright/DOM types), (b) reading the spec back against the four files above to confirm every locator matches real, current markup (done directly, not guessed), and (c) true pass/fail is deferred to Task 4 — running this spec means starting the built app on port 3000 via Playwright's `webServer`, which must not happen while the dev server already on that port is serving manual testing.

- [x] **Step 1: Write the spec**

Create `e2e/counting-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('sign in, record a count, and see it on the report', async ({ page }) => {
  // Authenticated via the `authenticated` project's storageState (Task 2) —
  // no sign-in UI in this test; the allowlist gate still ran server-side for
  // every request below, exactly as for a real signed-in user.
  await page.goto('/dashboard')

  await page.getByRole('button', { name: /start counting today.s service/i }).click()
  await expect(page).toHaveURL(/\/entry\/[^/]+$/)
  const eventId = new URL(page.url()).pathname.split('/').pop()!

  // Left Wing: a real seeded Sanctuary section (prisma/seed.ts's
  // DEFAULT_CATEGORIES), rendered by SanctuaryMap as an accessible button
  // labelled "Left Wing, count <n>".
  await page.getByRole('button', { name: /^Left Wing,/i }).click()

  const dialog = page.getByRole('dialog', { name: 'Count for Left Wing' })
  await expect(dialog).toBeVisible()
  // +10 three times + +1 once = 31 — a specific, non-zero, easy-to-verify number.
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: '+10' }).click()
  await dialog.getByRole('button', { name: 'Increase count' }).click()
  await expect(dialog.getByRole('status')).toHaveText('31')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  await page.goto(`/report/${eventId}`)

  const leftWingRow = page.locator('tr', { hasText: 'Left Wing' })
  await expect(leftWingRow.locator('td').nth(1)).toHaveText('31')

  const totalRow = page.locator('tr', { hasText: 'Total' })
  await expect(totalRow.locator('td').nth(1)).toHaveText('31')
})
```

A few concrete notes on choices made above, so a reviewer doesn't have to re-derive them:
- `+10` is clicked via its visible label (the buttons in `CounterDialog` are `{[5, 10, 25].map(...)}` rendered as `<button>+{step}</button>` — `+10` is real, exact text).
- The count `<output>` element in `CounterDialog` has no explicit ARIA role override, so it exposes the implicit `status` role (an `<output>` element's default ARIA role) — `dialog.getByRole('status')` targets it; this is more resilient than a raw text-content check because it doesn't depend on surrounding whitespace.
- `Increase count` is `CounterDialog`'s `aria-label` for the `+1` button — used once instead of a fourth `+10` purely so the total (31) isn't a suspiciously round multiple of 10, making a copy-paste/off-by-one bug more visible if one existed.
- The report assertions use `page.locator('tr', { hasText: ... })` rather than a `data-testid` (none exist in this codebase's convention — every other component here is styled inline with no test hooks) — `hasText` matching against the real rendered category name and the literal "Total" row is a faithful re-derivation of `src/app/report/[eventId]/page.tsx`'s actual `<tr><td>{row.name}</td><td>{row.count}</td></tr>` / `<tr><td>Total</td><td>{totals.grand}</td></tr>` markup, not an assumption.

- [x] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 3: Confirm the spec is picked up by the intended project only**

```bash
npx playwright test --list
```

This lists tests without starting the `webServer` or running anything — it's a manifest dry-run, not an execution, so it's safe to run alongside the port-3000 dev server. Expected output includes `unauthenticated > auth.spec.ts` (3 tests, unchanged from today) and `authenticated > counting-flow.spec.ts` (1 test) — confirming the `testMatch` globs in Task 2 Step 3 routed each file to the right project, and that `e2e/global-setup.ts` itself was not mistakenly picked up as a test file.

If this command's dry-run turns out to still invoke `globalSetup` (some Playwright versions run global setup even for `--list`) and that fails locally for lack of a reachable Postgres/allowlist row, that failure is expected and fine in this environment — it does not require a code change, only a real database (Task 4's job).

- [x] **Step 4: Commit**

```bash
git add e2e/counting-flow.spec.ts
git commit -m "test: add e2e coverage for sign-in, recording a count, and the report"
```

---

### Task 4: What a green CI run looks like (deferred true verification)

**Files:** none — this task runs no commands against the local port-3000 dev server or its database. It describes the verification that Tasks 1–3 could not perform locally, for whoever next has a CI runner (or a genuinely disposable local Postgres container on a free port) available.

- [ ] **Step 1: Push the branch and watch the `test` job**

On a real GitHub Actions run of the updated `tests.yml`:
1. The `postgres:16` service container starts and reports healthy (`pg_isready`) before the first step runs.
2. `npm ci`, `npm run lint`, `npm test` run exactly as before — `npm test`'s output should show the same three live-DB suites (`seedCategories (live database)`, `signInCallback (allowlist gate, live database)`, `schema constraints (live database)`) reporting as **skipped**, not run and not failed — confirming Task 1 Step 4's judgment call held in the real environment, not just by code inspection.
3. `npm run build` runs unchanged.
4. The new `Apply database migrations` step ends with Prisma's `deploy` success message (no shadow-database prompt — `migrate deploy` never creates one).
5. The new `Seed the database` step logs `Seeded admin: e2e-admin@example.com` followed by the retire/seed category counts, exactly as it does locally today.
6. `Install Playwright browsers` runs unchanged.
7. `Run end-to-end tests` runs both projects: `unauthenticated` (3 tests, identical to pre-this-plan CI runs) and `authenticated` (the new 1-test spec). All 4 tests pass.
8. `npm audit` and the `gitleaks`/`semgrep` jobs are unaffected by any of this.

- [ ] **Step 2: If the e2e step fails, the likely causes in order of likelihood**

(Documented here rather than discovered by trial and error, since this environment can't run the job to find out directly.)
1. `AUTH_SECRET` mismatch between the minting side and the decoding side — should be structurally impossible given both read from the same step's `env:` block, but this is the first thing to `echo`-verify (length only, never the value) if the authenticated project's test fails at `/dashboard` with a redirect to `/login`.
2. The seed step ran against a different database than the e2e step's app — verify both steps' `env:` blocks use the identical `DATABASE_URL`.
3. A cold `chromium.launch()` inside `global-setup.ts` timing out in a constrained CI runner — increase Playwright's default global setup timeout if this is ever observed (not expected; `@playwright/test`'s browsers are already installed by the preceding step).

- [ ] **Step 3: Once green, this plan is complete.** No further commits are expected from this task unless Step 2's failure modes require a fix — if so, fix, re-run Tasks 1–3's local verifications (`tsc --noEmit`, the YAML dry-run, `playwright test --list`), and repeat this task's CI run.
