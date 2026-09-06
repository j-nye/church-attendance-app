# Threat Model — Church Attendance App

Companion to `docs/superpowers/plans/2026-08-31-roadmap.md` Phase 5 and the deploy
checklist (`2026-08-31-deploy-checklist.md`). This describes what's actually at risk in
this app, how the current code defends against it, and what's left over that the owner
should know about — not a generic security template.

## Assets

What an attacker (or an accident) could actually expose or corrupt here:

- **Attendance headcounts** — the core data. Low sensitivity individually, but the
  whole point of the app, so integrity (nobody can quietly falsify a count) matters
  more than confidentiality.
- **Volunteer and admin email addresses** — stored in the `Allowlist` table, and again
  in every `AttendanceRecord.recordedBy` and `ServiceSpeaker.recordedBy` field (who
  entered what). This is personal information about real church volunteers.
- **The `AuditLog` table** — a record of who deleted which count and what the count
  was before deletion. Exposing this reveals volunteer email addresses tied to a
  specific admin action; corrupting or losing it removes the only accountability trail
  the app has.
- **Google OAuth credentials** (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`) — if leaked,
  someone could impersonate the app to Google or intercept its OAuth flow.
- **`AUTH_SECRET`** — the single most sensitive value in this app. See "Threats" below.
- **Database credentials** (`DATABASE_URL` / `DIRECT_URL`) — full read/write access to
  every table above.

## Trust boundaries

The app has exactly one real authorization boundary, and it is deliberately **not**
the middleware. `src/middleware.ts` says this about itself, verbatim:

> COSMETIC ONLY. This bounces signed-out visitors to /login so they do not see a
> broken page. It is NOT a security boundary — every Server Action and page enforces
> access itself via requireUser()/requireAdmin() in src/lib/authz.ts.

Concretely: the middleware only checks whether a session *exists* (`req.auth?.user?.email`)
and, if not, redirects to `/login`. It never checks the Allowlist, never checks role,
and its `matcher` explicitly excludes `/api` entirely:
```
matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
```
So API routes get **no** middleware treatment at all — not even the cosmetic
redirect-if-signed-out.

The real boundary is `src/lib/authz.ts`'s `requireUser()` / `requireAdmin()`, called as
the first statement of every Server Action and API route handler. Each call:
1. Reads the next-auth session via `auth()` — identity only (an email).
2. Re-queries the `Allowlist` table from the database for that email, checking
   `isActive`.
3. Throws `AuthzError` if there's no active row (or, for `requireAdmin()`, if the role
   isn't `ADMIN`).

This is genuine defense-in-depth by re-checking, not by trusting a cached claim: a
revoked user's *next* request is refused immediately, with no JWT expiry to wait out.
`src/lib/auth.ts`'s session `maxAge` (7 days) governs how often someone has to
re-authenticate with Google, not how long their authorization lasts — those are
different questions, and only the second one matters for security. This mirrors
`AGENTS.md`'s stated philosophy exactly: "Never trust the session alone; always query
the database."

## Actors

- **Unauthenticated visitor** — no session. Middleware bounces them to `/login` for
  page routes; anything hitting a Server Action or API route directly without a
  session gets `AuthzError('UNAUTHENTICATED')` from `requireUser()`.
- **Allowlisted VOLUNTEER** — signed in, active row in `Allowlist` with role
  `VOLUNTEER`. Can record counts; blocked by `requireAdmin()` from admin-only actions
  (category/allowlist management, CSV export, deleting counts).
- **Allowlisted ADMIN** — everything a volunteer can do, plus category/event
  management, allowlist management, CSV export, and deleting a saved count.
- **A revoked-but-still-logged-in user** — someone whose `Allowlist.isActive` was just
  flipped to `false` (or role downgraded) while they still hold a valid, unexpired
  session cookie. Their *next* Server Action call fails at the `requireUser()`/
  `requireAdmin()` check, because that check re-reads the database every time rather
  than trusting anything in the JWT. This is the scenario the whole re-check design
  exists for, and it works as intended — there is no window where a revoked user can
  keep mutating data just because their cookie hasn't expired.

## Threats and how the current code holds up

**A leaked `AUTH_SECRET` lets someone forge a session for any email.** This deserves
its own paragraph because Phase 4 just built infrastructure that does exactly this on
purpose, for testing: `e2e/global-setup.ts` uses `next-auth/jwt`'s `encode()` with the
running `AUTH_SECRET` to mint a valid session cookie for `e2e-admin@example.com`
without ever going through Google — by design, since it's the only way to get a real
session into a headless browser test. That file's own comment is explicit about the
boundary: "This file is test tooling only: it is never imported by anything under
src/, and it adds no new code path to the shipped app." That claim is correct — the
`encode()` call lives only in `e2e/`, nothing under `src/` can produce a session this
way, and the code path an attacker would need (a way to mint or accept a forged token
in the running app) simply isn't there. But the underlying mechanism the test relies
on is real: **anyone who has the production `AUTH_SECRET` can run the same three lines
of code** to mint a cookie for an email they choose. Because `requireUser()` /
`requireAdmin()` check the *email* in the token against the Allowlist rather than
verifying anything about how that email was authenticated, a forged session for a
known allowlisted admin's email would pass authorization exactly as if that admin had
signed in with Google. This is precisely why the deploy checklist insists on a fresh,
never-reused `AUTH_SECRET` for production, generated independently from whatever value
local dev or CI uses — CI's `AUTH_SECRET` values are explicitly labeled
`ci-build-placeholder-not-a-real-secret` / `ci-e2e-placeholder-not-a-real-secret` in
`.github/workflows/tests.yml`, and must never be reused anywhere real.

**SQL injection.** All database access goes through Prisma's generated client with
parameterized queries — there is no raw SQL string concatenation anywhere in
`src/lib/actions/` or the API routes. This class of attack is mitigated by using the
ORM as intended, not by any manual escaping the app does itself.

**CSV export exposes volunteer emails.** `GET /api/export` (`src/app/api/export/route.ts`)
includes a `Recorded By` column with the volunteer or admin's email for every row.
This is by design and gated by `requireAdmin()` at the top of the handler — only
admins can pull it, which matches who already has visibility into who-recorded-what in
the UI. Worth knowing, not a bug: any admin can download every volunteer's email
address in one file.

**The `/api/export` auth check happens inside the handler, not at the edge.**
Because `middleware.ts`'s matcher excludes `/api` entirely (see Trust boundaries
above), an unauthenticated request to `/api/export` is not intercepted before it
reaches the route — it's `requireAdmin()`, called as the first line inside `GET()`,
that rejects it (returning a 403 with the `AuthzError` message). This is an accepted,
understood design choice consistent with the rest of the app: the middleware was never
meant to be the security boundary for *any* route, page or API, so `/api` skipping it
entirely doesn't weaken anything — the same `requireAdmin()` call that would run
regardless still runs, just without a redundant earlier check.

## Residual risks (not blocking launch, but worth knowing)

- **No rate limiting** on sign-in attempts or on `/api/export`. Nothing currently
  throttles repeated requests to either. For sign-in, Google's own OAuth flow absorbs
  most abuse; the Allowlist check means a stranger can't get in regardless of attempt
  count. For `/api/export`, a malicious or careless admin account could hammer the
  endpoint, but that's an already-trusted account at that point.
- **`AuditLog` only covers one action.** Per its own schema comment, it's "the only
  irreversible action in an app that otherwise soft-deletes on principle" —
  `deleteCount` (`action: 'DELETE_COUNT'`). Every other mutation (editing a count,
  archiving an event, deactivating a category, changing someone's Allowlist role) has
  no audit trail at all beyond each record's own `updatedAt` timestamp. If an admin's
  account is misused to, say, silently change a bunch of historical counts (not delete
  them), there is no log of what the value was before.
- **Single shared Neon database, no documented backup or read-replica strategy.**
  Neither `README.md` nor anything else in this repo describes a backup policy,
  point-in-time recovery plan, or read replica. Neon's own platform does offer
  point-in-time restore on paid plans, but whether that's configured, tested, or even
  enabled for this project isn't something the codebase can answer — that's an open
  question for whoever manages the Neon account, not something to assume is handled.
- **The repo is now public (owner's choice, 2026-09-04), which changes the asset
  picture slightly.** The source code itself was already free of secrets — no
  credentials, no `.env*` beyond `.env.example`, no real personal emails in any
  tracked file (verified directly before the visibility change, beyond gitleaks'
  own clean per-commit scan) — so the switch doesn't expose anything that wasn't
  already treated as sensitive. It does mean the app's authorization logic,
  including the exact shape of `requireUser()`/`requireAdmin()` and this threat
  model itself, is now readable by anyone. Nothing in the design relies on the
  source being secret (the real boundary is the Allowlist table and `AUTH_SECRET`,
  neither of which live in the repo), so this is a low-risk trade, made to unlock
  the two items below.
- **CodeQL is now enabled** (`ENABLE_CODEQL` repository variable set to `true`,
  2026-09-04) — `.github/workflows/codeql.yml`'s gate (`if: vars.ENABLE_CODEQL ==
  'true'`) was unblocked by the repo going public, exactly as its own comment
  anticipated. Runs alongside the existing Semgrep scan (`p/typescript`,
  `p/nextjs`, `p/javascript`) in the same CI pipeline.
- **Branch protection on `main` is now active** (2026-09-04): the `test`,
  `semgrep`, and `gitleaks` checks are required and must be up to date before a
  merge is accepted; force-pushes and branch deletion are disabled. `enforce_admins`
  is deliberately `false` — the owner (as the repo's sole admin) can still push
  directly to `main`, matching the existing solo-maintainer workflow. Any future
  non-admin collaborator would be forced through a pull request with passing
  checks. This was blocked by the same GitHub plan-tier gate as CodeQL until the
  repo went public — confirmed at the time via `gh api repos/.../branches/main/protection`
  returning "Upgrade to GitHub Pro or make this repository public."
