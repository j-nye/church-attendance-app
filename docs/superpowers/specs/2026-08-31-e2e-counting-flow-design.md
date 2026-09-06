# E2E counting-flow test

**Date:** 2026-08-31
**Status:** Approved, pending implementation plan

## Motivation

AGENTS.md names this the known gap: "Counting logic (saveCount, getEventCounts) has only
unit tests. E2E coverage is thin." The existing `e2e/auth.spec.ts` covers only the
unauthenticated boundary (redirect to `/login`, a blocked POST to a protected route) — it
never signs in, because there is no real database in CI to sign in against. Today's CI
runs `npm run test:e2e` with a **fake** `DATABASE_URL`
(`postgresql://user:pass@localhost:5432/db`) that nothing ever queries, since the existing
spec's assertions all resolve before any Prisma call. This spec adds the one high-risk
flow AGENTS.md flags as thin: sign in, record a count, see it on the report — which
requires two things that don't exist yet: a real reachable database in CI, and a way to
be "signed in" in a headless browser without a live Google OAuth consent screen.

## Decision (2026-08-31): Docker Postgres in CI

A Postgres service container in the GitHub Actions job, not a Neon branch. Self-contained
(no external account coupling, no risk to the real dev database), free, and matches what
a contributor can run locally with one `docker run`. Neon's branching feature is a fine
production-safety tool but adds account/API dependencies this test suite doesn't need —
revisit only if the suite outgrows a plain container.

## Test-database wiring

- `.github/workflows/tests.yml`: add a `postgres:16` service container to the `test` job
  (standard `services:` block, health-checked, port 5432 exposed to the runner).
- Before the e2e step: `DATABASE_URL`/`DIRECT_URL` point at the service container (real
  values, replacing the current fake placeholder for the e2e step specifically — the
  `npm test` unit-test step keeps using no `DATABASE_URL` at all, since its live-DB
  suites are designed to skip without one, and the `npm run build` step's placeholder is
  unaffected since Next's build never queries the database).
- `npx prisma migrate deploy` runs against the container before `npm run db:seed`.
- `npm run db:seed` runs with `SEED_ADMIN_EMAIL` set to a fixed test address (e.g.
  `e2e-admin@example.com`) — this is the **existing** seed script, unmodified: it creates
  the full default category list (so there's a real Sanctuary section to tap) and the one
  admin Allowlist row, exactly as it does for local dev.

No new database-seeding code is written for this feature — it reuses `prisma/seed.ts` as
its own bootstrap, the same script a developer runs locally.

## Test-session strategy: mint a JWT, never touch Google

A Playwright **global setup** script (`e2e/global-setup.ts`, wired via
`playwright.config.ts`'s `globalSetup`) that:

1. Calls `encode()` from `next-auth/jwt` (confirmed present and stable in the installed
   `next-auth`/`@auth/core` version) with `{ secret: process.env.AUTH_SECRET, salt:
   'authjs.session-token', token: { email: 'e2e-admin@example.com', sub: 'e2e-test-admin',
   name: 'E2E Admin' } }` to produce a session JWT signed with the same secret the running
   app uses.
2. Uses Playwright's browser-context API to set that value as a cookie named
   `authjs.session-token` (the exact name `@auth/core` reads for an unprefixed/non-`https`
   session — confirmed by reading `node_modules/@auth/core/lib/utils/cookie.js`) against
   `http://localhost:3000`, then saves it as a Playwright **storageState** file.
3. The new spec's Playwright project uses `storageState` (already-authenticated) for its
   test; `e2e/auth.spec.ts` keeps running with no storage state, exactly as today.

**This is the load-bearing security property of this spec, stated explicitly:** the
minting logic lives **only** in `e2e/global-setup.ts` — a Playwright test-tooling file,
never imported by anything under `src/`. No new code path in the shipped application can
produce a session from anything other than a real Google sign-in verified by
`signInCallback` in `src/lib/auth.ts`. This spec adds zero lines to `src/lib/auth.ts`,
`src/middleware.ts`, or `src/lib/authz.ts`. `AUTH_SECRET` in CI is already a
committed-in-workflow placeholder value (`ci-e2e-placeholder-not-a-real-secret`), not a
real secret — this test signs its own tokens with a value that grants no access to any
real deployment, because no real deployment shares that secret.

The allowlist gate still applies in full: the minted token supplies only *identity*
(`email`); `requireUser()`/`requireAdmin()` still independently look up
`e2e-admin@example.com` in the seeded `Allowlist` table on every action, exactly as for a
real user. If the seed step didn't run, the test fails at the first action call with
`AuthzError`, not silently.

## New Playwright spec — `e2e/counting-flow.spec.ts`

One flow, thin, matching AGENTS.md's "don't e2e everything" guidance:

1. Start with the authenticated `storageState`, navigate to `/dashboard`.
2. Tap "Start counting today's service" (exercises `getOrCreateTodayEvent`, including its
   Phase 3 race-fix path implicitly — a single test won't race it, but it runs the happy
   path for real).
3. On the entry screen, tap a real seeded Sanctuary section, use the counter dialog to
   enter a specific number, save.
4. Navigate to that service's report page; assert the entered number appears in the
   correct row and the grand total reflects it.

This is the one flow AGENTS.md calls high-risk (recording a count and reading it back
through a real save → revalidate → re-render cycle) — not a tour of every feature shipped
this session. Speakers, CSV export, Manage Records, and the settings redesign stay
unit-tested only, per the existing "keep the suite fast" convention.

## Local developer story

Documented in the plan, not new infrastructure: a `docker run` one-liner to start a local
Postgres container, then the same `migrate deploy` / `db:seed` / `test:e2e` sequence CI
uses. No `docker-compose.yml` is added — the CI service-container block and one README/
plan note are enough for a single-container need.

## Testing the test

- Manual: run the new CI job (or the equivalent commands locally against a throwaway
  container) and confirm the counting-flow spec passes; confirm `e2e/auth.spec.ts` is
  unaffected (still runs with no storage state, still passes).
- No unit tests for `e2e/global-setup.ts` itself — it's test tooling, exercised by running
  the e2e suite, matching this project's convention for infrastructure/tooling code.

## Non-goals / out of scope

- No Neon branch integration — revisit only if Docker Postgres in CI proves insufficient.
- No e2e coverage of speakers, CSV export, Manage Records, or the settings redesign —
  those stay unit-tested; this spec adds exactly one flow.
- No change to `src/lib/auth.ts`, `src/middleware.ts`, or `src/lib/authz.ts` — the test
  session mechanism is entirely external to the application.
- No `docker-compose.yml` or other new local-dev tooling beyond a documented command.
