# Church Attendance App

A web app for recording church attendance headcounts. Volunteers tap sections of an
SVG sanctuary map to log counts for a service; admins manage categories and an email
allowlist, view printable reports, and export attendance data as CSV. The app is
deliberately generic — no church name or branding is hard-coded into the UI.

## Tech Stack

- [Next.js 16](https://nextjs.org) (App Router) + [React 19](https://react.dev)
- [Prisma](https://www.prisma.io) + Postgres, hosted on [Neon](https://neon.tech)
- [next-auth v5 (beta)](https://authjs.dev) with Google OAuth
- [Zod](https://zod.dev) for input validation
- [Vitest](https://vitest.dev) (unit) and [Playwright](https://playwright.dev) (e2e)

## Getting Started

1. **Node version** — this project targets Node 22 (see `.nvmrc`). Use `nvm use` or
   otherwise match that version.
2. **Install dependencies:**
   ```bash
   npm ci
   ```
3. **Configure environment variables** — copy `.env.example` to `.env.local` and fill
   in each value:
   - `DATABASE_URL` — pooled Postgres connection string (Neon).
   - `DIRECT_URL` — direct (non-pooled) Postgres connection string, used by Prisma
     for migrations.
   - `AUTH_SECRET` — secret used by next-auth to sign sessions/tokens.
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth client credentials (see
     below).
   - `SEED_ADMIN_EMAIL` — the email address that becomes the first `ADMIN` in the
     Allowlist table when you run the seed script. Without it, `db:seed` fails and
     nobody can sign in.
4. **Run migrations:**
   ```bash
   npm run db:migrate
   ```
5. **Seed the database** (creates the admin allowlist entry and default categories):
   ```bash
   npm run db:seed
   ```
6. **Start the dev server:**
   ```bash
   npm run dev
   ```
   The app runs at [http://localhost:3000](http://localhost:3000).

## Google OAuth Setup

Create an OAuth 2.0 client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
and use its client ID/secret for `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. For local
development, add this authorized redirect URI:

```
http://localhost:3000/api/auth/callback/google
```

Signing in with Google only grants access if the account's email exists and is
active in the Allowlist table (see below).

## Testing

- **Unit tests** (Vitest):
  ```bash
  npm test
  ```
  Tests that need a real database load credentials from `.env.local`
  (`tests/setup.ts`); if that file is absent (e.g. in CI), those tests skip
  themselves instead of failing.
- **End-to-end tests** (Playwright):
  ```bash
  npm run test:e2e
  ```
  This builds and starts the app and exercises it in a real browser.

## Key Concepts

- **Allowlist authorization** — every mutation re-checks the `Allowlist` table from
  the database (never trusting the session alone), so deactivating a user revokes
  their access immediately, with no JWT expiry to wait out.
- **Soft deletes** — `Event.isArchived`, `Category.isActive`, and
  `Allowlist.isActive` retire rows without deleting history. Mutations must reject
  writes against archived events or inactive categories.
- **`serviceDate` format** — stored as a church-local calendar string `YYYY-MM-DD`
  (America/New_York), not a timestamp. See `src/lib/dates.ts`.
- **CSV export** — admin-only, served from `GET /api/export`, protected by
  `requireAdmin()`.

## Learn More

- [`AGENTS.md`](./AGENTS.md) — conventions for contributors and coding agents
  (authorization patterns, Prisma conventions, validation, testing expectations).
- [`docs/superpowers/`](./docs/superpowers) — specs and plans, including the
  current roadmap at
  [`docs/superpowers/plans/2026-08-31-roadmap.md`](./docs/superpowers/plans/2026-08-31-roadmap.md).
