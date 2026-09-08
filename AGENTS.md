# Agent Guidelines for church-attendance-app

This document encodes the project's conventions, tech decisions, and gotchas. Agents should read this before writing code.

<!-- BEGIN:nextjs-agent-rules -->

## Next.js 16.3.0 + React 19.2.8 (Bleeding Edge)

This codebase uses Next.js 16.3.0 and React 19.2.8 — both with **breaking changes** from earlier versions. Your training data is stale here.

**Before writing any code, read:**
- `node_modules/next/dist/docs/` for Next.js 16.3.0 API changes
- React 19 upgrade guide for hook/API changes
- next-auth v5.0.0-beta.32 migration guide (we're on beta, not stable)

**Key breaking changes:**
- React 19 compiler optimizes memoization automatically — manual `useMemo`/`useCallback` is now often worse, not better
- Next.js 16 has new routing and data-fetching patterns
- next-auth v5-beta has breaking API changes from v4

Do NOT apply optimization rules from older documentation. Test locally.

<!-- END:nextjs-agent-rules -->

---

## Authorization: Every Mutation Checks Allowlist

All mutations (server actions, API routes) **must** call `requireUser()` or `requireAdmin()` before modifying data.

**Pattern:**
```typescript
// src/lib/authz.ts
export async function requireUser(): Promise<CurrentUser> {
  // 1. Get session from next-auth
  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) throw new AuthzError('UNAUTHENTICATED')

  // 2. Check Allowlist table — this revokes access immediately
  const entry = await prisma.allowlist.findUnique({ where: { email } })
  if (!entry || !entry.isActive) throw new AuthzError('FORBIDDEN')

  return { email: entry.email, role: entry.role as Role }
}
```

**Why this matters:**
- Deactivating an Allowlist row revokes access **immediately** — no JWT expiry wait.
- Every mutation re-checks, so the Allowlist is the source of truth.
- Never trust the session alone; always query the database.

**Do:**
- Start every server action with `const user = await requireUser()`
- Reject mutations on archived events or inactive categories
- Derive `recordedBy` from the session, never from input
- Use `requireAdmin()` for admin-only operations

**Don't:**
- Skip authorization checks (even for "harmless" reads that might leak permission state)
- Trust that a valid ID means access is permitted
- Allow input to override server-derived fields like `recordedBy`, `createdAt`, or role checks

---

## Prisma Conventions

### Schema Guards
Three models have `isActive` or `isArchived` fields to soft-delete without losing data:
- `Event.isArchived` — closed service dates don't accept counts
- `Category.isActive` — retired sections don't accept counts
- `Allowlist.isActive` — revokes access without deleting the user record

Always check these in mutations: if an event is archived, reject the count.

### Data Model
```
Allowlist (who can sign in)
├─ email (unique)
├─ googleSub (for future OAuth)
├─ role (ADMIN | VOLUNTEER)
└─ isActive (revokes access immediately)

Event (a service date)
├─ serviceDate (YYYY-MM-DD, not a timestamp — see src/lib/dates.ts)
├─ name (event name within that date)
├─ isArchived (soft-delete)
└─ records (AttendanceRecord[])

Category (a section/classroom/metric to count)
├─ type (SECTION | CLASSROOM | GROWTH_TRACK | SERVE_TEAM | SERVICE_METRIC)
├─ name (unique per type)
├─ countsTowardTotal (false for metrics like Salvations that shouldn't be in Total)
├─ svgKey (for sanctuary map visualization)
├─ sortOrder (UI ordering)
├─ isActive (soft-delete)
└─ records (AttendanceRecord[])

AttendanceRecord (the actual count)
├─ eventId + categoryId (unique — upsert prevents double-counts)
├─ count (the number)
├─ recordedBy (derived from session — never from input)
└─ timestamps
```

### Idempotency Pattern
Use `upsert` for counts — double-taps or a second volunteer don't double-count:
```typescript
await prisma.attendanceRecord.upsert({
  where: { eventId_categoryId: { eventId, categoryId } },
  create: { eventId, categoryId, count, recordedBy: user.email },
  update: { count, recordedBy: user.email }, // overwrite, don't accumulate
})
```

### Validation Before Mutation
Always fetch and validate referenced rows before writing:
```typescript
const [event, category] = await Promise.all([
  prisma.event.findUnique({ where: { id: eventId } }),
  prisma.category.findUnique({ where: { id: categoryId } }),
])
if (!event || event.isArchived) throw new Error('That service is not accepting counts')
if (!category || !category.isActive) throw new Error('That category is no longer active')
```

This prevents writing orphaned records and enforces business rules.

---

## Server Actions & Cache Invalidation

All mutations are server actions in `/src/lib/actions/*.ts`:
- `attendance.ts` — save/get counts
- `events.ts` — create/edit/archive events
- `categories.ts` — create/edit/deactivate categories
- `allowlist.ts` — manage users

**Always call `revalidatePath()` after mutations:**
```typescript
await prisma.attendanceRecord.upsert(/* ... */)
revalidatePath(`/entry/${eventId}`)  // the entry form
revalidatePath(`/report/${eventId}`) // the report that shows totals
return { ok: true as const }
```

Stale data in the UI is worse than a brief loading state. When in doubt, revalidate.

---

## Validation with Zod

All server action inputs are validated with Zod schemas in `src/lib/validation.ts`:
```typescript
import { saveCountSchema } from '@/lib/validation'
const { eventId, categoryId, count } = saveCountSchema.parse(input)
```

**Do:**
- Parse input with Zod before using it
- Use `.trim().toLowerCase()` for emails
- Let parse errors throw (they become bad request responses)

**Don't:**
- Trust input types — parse to Zod schemas first
- Use `unsafe` parsing
- Skip validation for "trusted" internal calls

---

## next-auth v5.0.0-beta.32 Specifics

This app uses next-auth **beta**, not stable v5. Breaking changes are possible.

**Session structure:**
```typescript
session.user.email  // the primary identifier
session.user.name   // optional (not used here)
```

**Authorization flow:**
1. OAuth provider (Google) → next-auth session
2. Server action calls `auth()` to get session
3. If email exists in Allowlist and `isActive`, grant access
4. If not, throw `AuthzError('FORBIDDEN')`

**Do:**
- Always call `auth()` at the start of protected server actions
- Trim and lowercase emails for comparison
- Assume the session.user.email is the source of truth

**Don't:**
- Cache the session in memory (re-fetch on each mutation)
- Trust the session without checking the Allowlist

---

## Testing

- **Unit tests:** 18 files / ~284 specs in Vitest — fast, run first
- **E2E tests:** 3 specs in Playwright against next-auth — auth surface, cross-role authorization, and the counting flow

**The gap:** Counting logic (saveCount, getEventCounts) has only unit tests. E2E coverage is thin.

**Running e2e locally uses a disposable database, not the real dev DB.** `.env.local` (and direnv's Doppler export in `.envrc`) point at the real Neon dev database — bare `npm run test:e2e` will write test fixtures (seeded allowlist rows, a real Event) into whatever database is currently active in your shell. Use `npm run test:e2e:local` instead: it starts a throwaway `postgres:16` Docker container (matching CI's service container, per the project's existing decision to use disposable Postgres rather than a Neon branch — see `docs/superpowers/plans/2026-08-31-roadmap.md`), and overrides `DATABASE_URL`/`DIRECT_URL`/`AUTH_SECRET` only in the spawned processes' env — never in a `.env` file, since a file-based override would be silently beaten by whatever direnv already exported into the shell. Requires Docker. `npm run db:test:down` stops the container when you're done.

### Tests are not optional — for new features AND for changes to existing ones

**Every behavior change ships with its tests in the same change.** Not in a follow-up, not "once it works". This applies equally to new features and to modifications of existing behavior — a change to working code is exactly where a silent regression hides.

**New behavior — write the test first.** Add a failing test that encodes the new rule, then make it pass. Put it in the existing file that covers that module (`tests/actions-events.test.ts` for event actions, `tests/validation.test.ts` for schemas, and so on) — do not create a parallel test file for a module that already has one.

**Changed behavior — find what you broke before you run the suite.** Before editing, grep the tests for the function, schema, or column you're about to change and read what they assert. Then, when something goes red:

- **A contract changed** → rewrite the test to encode the *new* contract. Keep the coverage.
- **Only a fixture is stale** (a newly-required field is missing) → add the field and leave the assertion alone.
- **Never** loosen or delete a strict assertion to get to green. A dropped `toHaveBeenCalledWith`, a deleted case, or a widened matcher is a silently removed guarantee. If a test seems to be "in the way", assume the implementation is wrong until proven otherwise — especially for the authorization and session-derivation tests, which exist precisely to fail when someone weakens them.
- **Watch for tests that pass for the wrong reason.** Adding a required field to a schema can make an unrelated test green via a different code path than the one it was written to check. Green is not the goal; green *for the stated reason* is.

**Run the real-database tests, not just the mocked ones.** Most of the suite mocks Prisma. `tests/prisma-schema.test.ts` and `tests/auth.test.ts` hit a real database, so a schema change — a new NOT NULL column especially — can leave every mocked test green while CI goes red. A migration is a behavior change and needs its fixtures updated like any other.

**Also update, when the behavior they describe changes:** the test's own name (a stale name teaches the next reader the wrong invariant), and any e2e selector that matches on user-visible text you just relabeled.

**When writing tests:**
- Unit: test Zod schemas, business logic, Prisma queries with mocks
- E2E: test auth flow and critical user paths (record a count, generate a report)
- Don't e2e everything — keep the suite fast; only test high-risk flows

---

## Security Scanning

Three tools, three different jobs. Don't conflate them — each catches something the others structurally can't.

### SAST — Semgrep
Runs in CI (`.github/workflows/tests.yml`'s `semgrep` job: `p/typescript`, `p/nextjs`, `p/javascript` against `src/`), required check on `main`. Catches source-level bug patterns before anything runs. Local check: `npm run security:sast` — runs the exact same config so a local pass means the CI job will pass too.

### Secrets — gitleaks
Already running (`gitleaks/gitleaks-action` in `tests.yml`), also a required check per the threat model (`docs/superpowers/plans/2026-08-31-threat-model.md`). Scans commit contents for things that look like credentials.

**Gotcha:** this is why CI's placeholder env vars are named things like `AUTH_SECRET: ci-build-placeholder-not-a-real-secret` instead of any other filler string — a value that merely *looks* like a real secret risks a false positive (or, worse, someone "fixing" it into an actual one later without realizing why it was fake). Follow the same naming convention for any new fake credential you add to CI or test fixtures.

### DAST — Nuclei (authenticated, local only)
`npm run security:dast` mints a real next-auth session — via `next-auth/jwt`'s `encode()`, the same trick `e2e/global-setup.ts` uses to skip a real Google OAuth flow — and runs Nuclei against the running dev server with that session cookie attached, so it scans past the login wall instead of just hitting `/login`.

**Deliberately scoped down, not a general-purpose scan:**
- **Not in CI.** It needs the `nuclei` binary + `nuclei-templates` on the runner and a running `next start`; that's a bigger lift than this covers today. Run it locally before shipping something that touches routing, headers, or middleware.
- **Only static pages** (`/dashboard`, `/settings` — see `scripts/security/dast-targets.txt`). `/entry/[eventId]` and `/report/[eventId]` need a real seeded event ID to be reachable and aren't crawlable, so they're out of scope until there's a clean fixture for that.
- **Tags are `misconfig,exposure` only** — no `sqli`/`xss`/`cors`. This app's mutations are Next.js Server Actions (opaque POSTs with an encrypted action ID), not URL/form params, so generic injection templates have near-zero yield here. Don't add those tags back without a reason; they'll just add noise to triage.
- **Cross-role authorization is not this tool's job.** "Can a VOLUNTEER reach an admin-only page" is covered by `e2e/authz.spec.ts` (a real Playwright assertion against `/settings`), not by a Nuclei template — that's a cheaper and more precise way to test that specific boundary.

---

## Common Gotchas

### Date Handling
`Event.serviceDate` is a string `YYYY-MM-DD`, not a timestamp. See `src/lib/dates.ts` for church-local calendar logic. Don't use `new Date()` directly; use the helpers.

### SVG Sanctuary Map
`Category.svgKey` keys into an SVG map element. Unknown keys are silently ignored. Keep the keys in sync with the SVG.

### Permissions Don't Cache
Every mutation re-fetches the Allowlist. If an admin deactivates a user, that user can't act on the next request — no waiting for a JWT to expire. This is intentional.

### Next.js 16 Cache Hierarchy
Next.js 16 has complex caching rules. If a mutation works locally but not in prod, suspect cache expiry. Use `revalidatePath()` liberally.

---

## File Structure

```
src/
├─ app/
│  ├─ api/          API routes (health checks, etc.)
│  ├─ dashboard/    Volunteer dashboard
│  ├─ denied/       Auth failure page
│  ├─ entry/        Attendance entry form
│  ├─ login/        Sign-in page
│  ├─ report/       Attendance report
│  └─ settings/     Admin settings
├─ lib/
│  ├─ actions/      Server actions (mutations)
│  ├─ authz.ts      Authorization helpers
│  ├─ dates.ts      Date utilities (church-local calendar)
│  ├─ prisma.ts     Prisma client singleton
│  └─ validation.ts Zod schemas
└─ components/      React components
```

---

## Deployment: Verify in Development Before Production

**No application change reaches production without first running in the development environment.** Not a schema change, not a behavior change, not a "small" fix. This is a release rule, not a preference.

### What the environments actually are

| Environment | Database | Doppler config | Triggered by |
|---|---|---|---|
| Local dev | Neon `church-attendance-app-dev` | `dev` (via direnv) | `npm run dev` |
| E2E | Disposable Docker Postgres | n/a (spawn-time override) | `npm run test:e2e:local` |
| Vercel Preview | Neon `church-attendance-app-dev` | `dev` | pushing any non-`main` branch |
| Vercel Production | Neon `church-attendance-app-prd` | `prd` | **merging to `main`** |

Merging to `main` deploys to production. There is no separate promotion step, so the branch *is* the gate.

### The required sequence

1. **Local** — `npm run lint && npm test && npx tsc --noEmit`, plus `npm run security:sast`.
2. **Real database** — if the change touches the schema, run the migration against the Neon dev database and confirm `tests/prisma-schema.test.ts` and `tests/auth.test.ts` pass. Mocked tests cannot see a migration.
3. **E2E** — `npm run test:e2e:local` (disposable Postgres; never bare `npm run test:e2e`, which writes fixtures into whatever database your shell currently points at).
4. **Preview deploy** — push the branch and exercise the change in the resulting Vercel Preview, which runs against the dev database.
5. **Manual pass** — click through the actual changed flows in Preview, not just locally. Reports get printed; counts get entered on phones.
6. **Only then** merge to `main`.

### Why the Preview step is not optional

Vercel's Build Command is `npx prisma migrate deploy && next build`. Migrations therefore run **during the build, while the previous deployment is still serving traffic** — so a migration and the code that depends on it are never live at the same instant. Preview is the only place that sequence gets rehearsed before it runs against production data.

This is exactly why a migration that adds a `NOT NULL` column keeps its database default through the rollout and drops it in a later, separate migration: during the build window, the old code is still inserting rows without the new field. Expand in one release, contract in the next.

### Production is not a test environment

If something can only be verified in production, that is a gap to close, not a reason to skip ahead. Neon's backup retention on the production project is a documented, accepted risk — not a rollback plan (see `docs/superpowers/plans/2026-08-31-roadmap.md`).

---

## Before Submitting

- [ ] Read the schema comments — they encode business rules
- [ ] Call `requireUser()` or `requireAdmin()` at the start of mutations
- [ ] Check `isArchived` and `isActive` before mutations
- [ ] Validate input with Zod — don't trust what comes in
- [ ] Call `revalidatePath()` after mutations
- [ ] Every behavior you added or changed has a test that fails without your change
- [ ] You grepped the existing tests for what you touched, and updated them by rewriting to the new contract — not by loosening assertions
- [ ] Run `npm run lint && npm run test && npx tsc --noEmit` — all three must pass
- [ ] If your change touched the schema, the real-database tests (`tests/prisma-schema.test.ts`, `tests/auth.test.ts`) ran and passed — mocked tests can't see a migration
- [ ] If you touch auth or counts, write an e2e test
- [ ] Verified in the development environment — local suite, then a Vercel Preview deploy against the dev database — **before** anything merges to `main` and ships to production
