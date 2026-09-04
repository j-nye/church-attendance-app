# First Production Deploy — Vercel + Neon

Companion to `docs/superpowers/plans/2026-08-31-roadmap.md` Phase 5. This is a
step-by-step checklist for taking this app from "runs on my laptop" to "live on the
internet for the church," the **first** time. Follow it in order — later steps assume
earlier ones are done. Re-deploys after this (just pushing to `main`) are much simpler
and are covered at the end.

You'll need accounts on: **Neon** (database), **Google Cloud Console** (sign-in), and
**Vercel** (hosting). You do not need to touch a terminal for most of this — the two
places you will run a command are generating a secret (step 3) and seeding the admin
(step 6).

---

## 1. Create the Neon production database

1. Sign in at [neon.tech](https://neon.tech) and create a **new project** for
   production — do not reuse whatever project/branch you used for local development.
   A name like `church-attendance-prod` is fine.
2. On the project's dashboard, find **Connection Details** (sometimes called
   "Connect"). Neon gives you two connection strings you need:
   - **Pooled connection** (the hostname usually contains `-pooler`) — this is your
     `DATABASE_URL`. The running app uses this for every normal query, because it goes
     through Neon's connection pooler, which serverless platforms like Vercel need.
   - **Direct connection** (no `-pooler` in the hostname) — this is your `DIRECT_URL`.
     Prisma uses this only for running migrations, which need a plain, non-pooled
     connection.
   - This split is not optional — `prisma/schema.prisma` declares both:
     `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`. If you swap
     them, migrations fail or the app misbehaves under load (see the troubleshooting
     section).
3. Copy both connection strings somewhere safe for step 4. Each already includes the
   username and password — treat them like a password.

## 2. Create a production Google OAuth client

Do **not** reuse the OAuth client you set up for local development (`localhost`). Make
a separate one for production so a compromised laptop dev-config can't affect the live
site, and so you can tell dev/prod traffic apart in Google's console.

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
2. Create a new **OAuth 2.0 Client ID**, type **Web application**, name it something
   like "Church Attendance — Production."
3. Under **Authorized redirect URIs**, add exactly:
   ```
   https://<your-domain>/api/auth/callback/google
   ```
   Same shape as the local dev entry (`http://localhost:3000/api/auth/callback/google`,
   documented in `README.md`) but `https` and your real domain. If you don't have a
   custom domain yet, use the `*.vercel.app` domain Vercel assigns in step 4 for now —
   you'll add the custom-domain URI in step 8 once you have one.
4. Copy the **Client ID** and **Client Secret**. These become `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET`.

## 3. Generate a real AUTH_SECRET

`AUTH_SECRET` is what next-auth uses to sign and encrypt session tokens. Never reuse
your local dev value in production — anyone who has it can forge a valid sign-in for
any allowlisted email (see the threat model doc for why this matters).

Auth.js (next-auth v5)'s own docs recommend generating it one of two ways:

```bash
npx auth secret
```
or, without needing the Auth.js CLI:
```bash
openssl rand -base64 33
```

Either produces a long random string. Copy it for step 4 — you don't need to save it
anywhere else, and you don't need to run this command *on* Vercel, just wherever you
have a terminal.

## 4. Create the Vercel project and set environment variables

1. At [vercel.com](https://vercel.com), **Add New Project** and import the
   `church-attendance-app` GitHub repository. Since the repo is private, Vercel's
   GitHub App needs access granted to it during import.
2. Vercel will auto-detect Next.js — leave the framework preset as-is.
3. Under **Project Settings → General**, confirm/set the Node.js version to match
   `package.json`'s `engines.node` (`22.x`) and `.nvmrc` (`22`).
4. Under **Project Settings → Environment Variables**, add all six variables from
   `.env.example`, scoped to **Production**:

   | Variable | Production value |
   |---|---|
   | `DATABASE_URL` | The **pooled** Neon connection string from step 1 |
   | `DIRECT_URL` | The **direct** Neon connection string from step 1 |
   | `AUTH_SECRET` | The freshly generated value from step 3 — must differ from your local `.env.local` value |
   | `AUTH_GOOGLE_ID` | The **production** OAuth client ID from step 2 — not the dev one |
   | `AUTH_GOOGLE_SECRET` | The **production** OAuth client secret from step 2 |
   | `SEED_ADMIN_EMAIL` | The real admin's actual Google account email — not `e2e-admin@example.com` (that's only used by CI's automated tests) |

   You do **not** need to set `AUTH_URL` or `AUTH_TRUST_HOST`. Auth.js v5 infers the
   host from request headers automatically, and auto-trusts the proxy on Vercel
   because Vercel sets its own `VERCEL` environment variable, which Auth.js checks for.
5. Be deliberate about whether Preview deployments (from PRs) also get these
   variables. Recommendation: **do not** point Preview deployments at the production
   Neon database — either scope the variables to Production only, or give Preview its
   own separate Neon branch. Mixing the two means a test PR could write real data into
   production, or an accidental preview deploy could seed/reseed prod. This repo does
   not currently document a Preview-environment database strategy — treat that as an
   open question for whoever owns ongoing deploys.

## 5. Set the build command so migrations actually run

Two things happen automatically and need no action from you:
- `npm install` (which Vercel runs) triggers this repo's `postinstall` script,
  `prisma generate` — so the Prisma client is always regenerated to match the schema.
- Vercel's default **Build Command** runs the `build` script, which is just
  `next build` — no migrations.

That means, unmodified, **a fresh deploy never applies your Prisma migrations** to
the production database. Fix this once:

1. Go to **Project Settings → Build & Development Settings**.
2. Override **Build Command** to:
   ```
   npx prisma migrate deploy && next build
   ```
3. Save. This setting sticks for every future deploy too — you only do this once.

`prisma migrate deploy` applies whatever's in `prisma/migrations/` (currently 4
migrations) that hasn't been applied yet, and is a no-op for migrations already
applied — safe to run on every deploy, not just the first.

Do **not** use `npm run db:migrate` for this — that script runs `prisma migrate dev`,
which is a local-development command that can prompt interactively and create new
migrations. It is the wrong tool for production and will not work non-interactively in
a build.

## 6. Deploy, then seed the production admin — once, manually

1. Trigger the deploy (push to `main`, or use Vercel's "Deploy" button after the
   settings above are saved). Watch the build logs to confirm `prisma migrate deploy`
   ran successfully before `next build` started.
2. Once the deploy is live, run the seed script **once**, from your own machine,
   pointed at the production database. Set `DATABASE_URL`, `DIRECT_URL`, and
   `SEED_ADMIN_EMAIL` to the same production values you put in Vercel (e.g. export
   them in your shell, or use a local `.env.production.local` file you do **not**
   commit), then run:
   ```bash
   npm run db:seed
   ```
   This is a manual, one-time step — nothing in the build automatically seeds the
   database, and it shouldn't (you don't want every deploy re-running seed logic
   against production without you watching).
3. Without `SEED_ADMIN_EMAIL` set, the seed script refuses to run — `prisma/seed.ts`
   throws `SEED_ADMIN_EMAIL is required — without it nobody can sign in.` So there's
   no risk of silently skipping this and ending up with an empty Allowlist.
4. Re-running `npm run db:seed` later (e.g. after adding a new category to the seed
   list, or just to be safe) is **safe and idempotent**: `seedCategories()` upserts
   categories on their `(name, type)` unique constraint and deterministically
   renumbers sort order every time, so running it twice in a row produces the same
   result the second time. It won't create duplicate categories or duplicate admins.

## 7. Verify the deploy actually works

1. Visit the production URL and sign in with the real admin's Google account (the one
   you put in `SEED_ADMIN_EMAIL`). You should land in the app, not on `/denied`.
2. Confirm the allowlist gate works: have someone sign in with a Google account that
   is *not* on the Allowlist (or temporarily deactivate a test row). They should be
   redirected to `/denied` — this is next-auth's configured error page
   (`src/lib/auth.ts`'s `pages: { error: '/denied' }`), reached whenever the sign-in
   callback rejects the account.
3. Confirm a real round-trip: as the admin, open the entry form, save a count for
   today's service, then open the report and confirm the number shows up there. This
   exercises the actual Neon database, not just the sign-in flow.

## 8. Custom domain (optional)

1. In **Project Settings → Domains**, add your domain and follow Vercel's instructions
   for the DNS record (CNAME or A record) at your domain registrar.
2. Once Vercel shows the domain as verified and serving traffic, go back to Google
   Cloud Console (step 2) and add a second **Authorized redirect URI** for the new
   domain: `https://yourchurchdomain.org/api/auth/callback/google`. You can leave the
   `*.vercel.app` one in place too, or remove it once you've confirmed the custom
   domain works.
3. No environment variable changes are needed for this — Auth.js infers the host from
   the incoming request, it doesn't need to be told the domain in advance.

## 9. If something's wrong

- **Land on `/denied` right after seeding.** Most likely cause: the seed ran against a
  *different* database than the one Vercel is actually using — double check
  `DATABASE_URL` in your local seed run matches what's in Vercel's environment
  variables exactly (easy to mix up if you have more than one Neon project/branch).
  Also check for a typo in the email — comparisons are done after
  `.trim().toLowerCase()`, so case and whitespace aren't the issue, but a wrong
  address is.
- **Google shows a redirect/configuration error before you even get to `/denied`.**
  The redirect URI in Google Cloud Console doesn't exactly match
  `https://<domain>/api/auth/callback/google` — check for `http` vs `https`, a
  trailing slash, or `www.` vs no `www.` mismatches.
- **Session/decrypt errors, or being signed out unexpectedly right after deploy.**
  `AUTH_SECRET` is either missing from the Production environment in Vercel, or it
  changed between deploys (e.g. someone regenerated it). All instances serving the app
  need the same value.
- **`prisma migrate deploy` fails during the build,** or the app can connect for
  normal use but migrations never seem to apply: check whether `DATABASE_URL` and
  `DIRECT_URL` got swapped in Vercel's environment variables — the pooled URL
  (`-pooler` in the hostname) cannot run migrations, only the direct URL can.

### After the first deploy

Future deploys are just: push to `main`. Vercel rebuilds, `prisma migrate deploy` runs
automatically as part of the build command you set in step 5 (applying any new
migrations you've added), and the seed step from step 6 does **not** need to be
re-run unless you're intentionally re-seeding (e.g. adding new default categories).
