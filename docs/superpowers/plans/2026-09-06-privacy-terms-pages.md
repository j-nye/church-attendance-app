# Privacy Policy & Terms of Service Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/privacy` and a `/terms` page to the app, accurate to what this
specific application actually does with Google sign-in data and attendance
records, linked from the login page, and usable as the Application Privacy
Policy / Terms of Service links Google's OAuth consent screen (Branding tab,
`church-attendance-auth` project) requires before it can be published to
production.

**Architecture:** Two new static Server Component pages (`src/app/privacy/page.tsx`,
`src/app/terms/page.tsx`) sharing one small layout component for consistent
typography/back-link chrome. The login page (`src/app/login/page.tsx`) gets a
footer line linking to both. No client interactivity, no data fetching, no new
dependencies — same plain-CSS-variable styling pattern already used by
`login/page.tsx` and `denied/page.tsx`.

**Tech Stack:** Next.js 16 App Router (Server Components), the existing
`src/styles/tokens.css` design tokens, `next/link`. No new packages.

**Spec:** This plan's own "Content" sections below — there is no separate spec
doc; the policy text is authored directly against this plan per the user's
request in-conversation (2026-09-06) for a "generic Application privacy policy
and terms of service" specific to this app, superseding the earlier idea of
linking Manna Church's org-wide Termly policy (that one covers church-wide
data practices — donations, events, etc. — not this app's specific use of
Google OAuth data, which is what Google's consent screen actually needs
disclosed).

## Global Constraints

- Entity name to use throughout: **Manna Church** (confirmed by the user).
- Contact email: `privacy@mannachurch.app` — a real, working mailbox (Cloudflare
  DNS + ForwardEmail.net routing confirmed live 2026-09-06, forwarding to an
  address the owner actually checks).
- Effective date on both pages: **September 6, 2026**.
- Must accurately reflect actual data handling — do not invent claims not
  backed by the codebase. Verified against `src/lib/auth.ts` (only `email` and
  `googleSub` are pulled from the Google profile into the session — no name or
  profile picture is stored or displayed anywhere in the app) and the schema
  in `AGENTS.md` (Allowlist, Event, Category, AttendanceRecord, AuditLog).
- No new npm dependencies. No new automated tests — this codebase has no
  component-render test setup (`tests/` is all business-logic/unit tests, no
  `@testing-library` dependency), and per `AGENTS.md`'s own testing
  philosophy ("don't e2e everything — only test high-risk flows"), two static
  content pages with no auth/data logic don't warrant introducing a new test
  pattern. Verification is manual: lint, build, and a real-browser check.

---

## File Structure

- **Create `src/components/LegalPageLayout.tsx`** — shared wrapper: max-width
  content column, a "back to sign in" link, page title, effective date. Used
  by both new pages so they look and behave identically without duplicating
  the layout chrome.
- **Create `src/app/privacy/page.tsx`** — Privacy Policy content, wrapped in
  `LegalPageLayout`.
- **Create `src/app/terms/page.tsx`** — Terms of Service content, wrapped in
  `LegalPageLayout`.
- **Modify `src/app/login/page.tsx`** — add a small footer line inside the
  existing `.card` linking to `/privacy` and `/terms`.

## Interfaces

- `LegalPageLayout` (new): `{ title: string; effectiveDate: string; children: React.ReactNode }` → renders the shared chrome and `children` inside a prose-styled `<div>`. Both new pages import it as `import { LegalPageLayout } from '@/components/LegalPageLayout'`.
- No other cross-task interfaces — these are static leaf pages.

---

### Task 1: Shared legal-page layout

**Files:**
- Create: `src/components/LegalPageLayout.tsx`

**Interfaces:**
- Produces: `LegalPageLayout({ title, effectiveDate, children })` — a named export, used by Tasks 2 and 3.

- [ ] **Step 1: Write the component**

```tsx
import Link from 'next/link'

export function LegalPageLayout({
  title,
  effectiveDate,
  children,
}: {
  title: string
  effectiveDate: string
  children: React.ReactNode
}) {
  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      <p>
        <Link href="/login">&larr; Back to sign in</Link>
      </p>
      <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>{title}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>Effective {effectiveDate}</p>
      <div style={{ lineHeight: 1.7 }}>{children}</div>
    </main>
  )
}
```

- [ ] **Step 2: Verify it type-checks and lints**

Run: `npm run lint`
Expected: no errors (this file isn't imported anywhere yet, so this only
checks the file parses and follows lint rules).

- [ ] **Step 3: Commit**

```bash
git add src/components/LegalPageLayout.tsx
git commit -m "feat: add shared layout for legal pages"
```

---

### Task 2: Privacy Policy page

**Files:**
- Create: `src/app/privacy/page.tsx`

**Interfaces:**
- Consumes: `LegalPageLayout` from Task 1.

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Privacy Policy — Church Attendance',
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" effectiveDate="September 6, 2026">
      <p>
        This Privacy Policy explains what information the Church Attendance app (the
        &ldquo;App&rdquo;) collects, why, and how it&rsquo;s used. The App is operated by
        Manna Church for internal use by its authorized volunteers and administrators.
      </p>

      <h2>Who can use the App</h2>
      <p>
        The App is invitation-only. Access is granted by a church administrator adding
        your email address to an internal allowlist. Signing in with a Google account
        that isn&rsquo;t on that allowlist will not grant access, regardless of any
        information Google shares during sign-in.
      </p>

      <h2>Information we collect</h2>
      <p>
        When you sign in with Google, we receive your email address and use it to check
        against our allowlist and to identify you inside the App. We do not store or
        display your name, profile picture, or any other Google profile information —
        only the email address is retained.
      </p>
      <p>
        Once signed in, the App stores the attendance counts you or other volunteers
        enter (a number per category per church service), which email address recorded
        each count, and timestamps. If a count is later deleted, we keep a record of who
        deleted it and what the value was beforehand, for accountability.
      </p>

      <h2>Google user data &amp; Limited Use</h2>
      <p>
        The App&rsquo;s use and transfer of information received from Google APIs adheres
        to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use your Google account only to
        verify your identity and check it against our allowlist, and only to provide the
        App&rsquo;s own features to you. We do not use it for advertising of any kind, do
        not sell or transfer it to data brokers or other third parties for their own
        purposes, do not use it to make credit or lending decisions, and do not use it to
        develop, improve, or train any AI or machine learning models, generalized or
        personalized.
      </p>

      <h2>How we protect your information</h2>
      <p>
        Access to the App is restricted to email addresses explicitly authorized on our
        allowlist — no one else can sign in, regardless of what Google account they use.
        Your data is stored on infrastructure provided by Vercel and Neon, both of which
        encrypt data in transit and at rest. Only administrators can export data or view
        the full accountability log of who recorded or deleted a count.
      </p>

      <h2>Analytics</h2>
      <p>
        The App uses Vercel Web Analytics to understand overall usage (like which pages
        are visited and how often). This is privacy-friendly, cookie-free analytics that
        does not track you individually across sites or sessions.
      </p>

      <h2>Who else sees this information</h2>
      <p>
        We don&rsquo;t sell or rent your information to anyone. It&rsquo;s shared only
        with the service providers that make the App run: Google (for sign-in), Vercel
        (application hosting), and Neon (database hosting). Within the App itself,
        administrators can see who recorded or deleted a given count, as part of the
        App&rsquo;s built-in accountability feature.
      </p>

      <h2>How long we keep it, and your deletion rights</h2>
      <p>
        Attendance records are kept indefinitely as part of the church&rsquo;s
        historical record-keeping. If your access is revoked (removed from the
        allowlist), your past entries remain associated with your email address for
        accountability purposes, but you can no longer sign in or record new data. You
        can request that we review, correct, or delete the personal information we hold
        about you (your email address and its association with past entries) at any
        time by contacting us using the details below; we&rsquo;ll respond and act on
        reasonable requests, balanced against the church&rsquo;s need to keep an accurate
        historical attendance and accountability record.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, we&rsquo;ll update the effective date at the top of this
        page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data? Email{' '}
        <a href="mailto:privacy@mannachurch.app">privacy@mannachurch.app</a>.
      </p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds, `/privacy` appears in the route list as a static
(`○`) page.

- [ ] **Step 3: Commit**

```bash
git add src/app/privacy/page.tsx
git commit -m "feat: add Privacy Policy page"
```

---

### Task 3: Terms of Service page

**Files:**
- Create: `src/app/terms/page.tsx`

**Interfaces:**
- Consumes: `LegalPageLayout` from Task 1.

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/LegalPageLayout'

export const metadata: Metadata = {
  title: 'Terms of Service — Church Attendance',
}

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" effectiveDate="September 6, 2026">
      <p>
        These Terms of Service govern your use of the Church Attendance app (the
        &ldquo;App&rdquo;), operated by Manna Church. By signing in, you agree to these
        terms.
      </p>

      <h2>What the App is for</h2>
      <p>
        The App is an internal tool for recording and reporting Sunday attendance
        counts across Manna Church&rsquo;s services, sections, and programs. It is not a
        public product and is not intended for use outside this purpose.
      </p>

      <h2>Who can use it</h2>
      <p>
        Access is limited to volunteers and staff explicitly authorized by a church
        administrator. You must sign in with the specific Google account your
        administrator approved. Sharing your access with someone else, or attempting to
        access the App with an account that hasn&rsquo;t been authorized, isn&rsquo;t
        allowed.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        When recording attendance, enter counts accurately and in good faith. If you
        have administrator access, use it responsibly — administrator actions (editing
        categories, managing the allowlist, exporting data, deleting counts) are logged
        and attributed to your account.
      </p>

      <h2>Access can be revoked</h2>
      <p>
        Manna Church may remove your access to the App at any time, for any reason,
        without notice — for example, if you stop volunteering or if your access is no
        longer needed. Revoking access takes effect immediately.
      </p>

      <h2>No warranty</h2>
      <p>
        The App is provided &ldquo;as is,&rdquo; without warranties of any kind. We do
        our best to keep it available and accurate, but we don&rsquo;t guarantee
        uninterrupted access or that it will be error-free.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Manna Church is not liable for any
        indirect, incidental, or consequential damages arising from your use of the
        App. This is a small, internally-run tool, not a commercial product with
        service-level guarantees.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If these terms change, we&rsquo;ll update the effective date at the top of this
        page. Continued use of the App after a change means you accept the updated
        terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{' '}
        <a href="mailto:privacy@mannachurch.app">privacy@mannachurch.app</a>.
      </p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds, `/terms` appears in the route list as a static
(`○`) page.

- [ ] **Step 3: Commit**

```bash
git add src/app/terms/page.tsx
git commit -m "feat: add Terms of Service page"
```

---

### Task 4: Link both pages from the login page

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: nothing new — plain `next/link` to the two routes created in Tasks 2–3.

- [ ] **Step 1: Add the footer link line**

Full resulting file:

```tsx
import Link from 'next/link'
import { SignInButton } from '@/components/SignInButton'

export default function LoginPage() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '24rem' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 0 }}>Church Attendance</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Sign in with the Google account your church administrator authorized.
        </p>
        <SignInButton />
        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Verify build and lint**

Run: `npm run lint && npm run build`
Expected: both pass; `/login` still builds as a static (`○`) page.

- [ ] **Step 3: Manual verification in a real browser**

Start the dev server preview, navigate to `/login`, and confirm:
- The "Privacy Policy" and "Terms of Service" links render and are clickable.
- Clicking each one lands on `/privacy` and `/terms` respectively, showing the
  full content, with a working "Back to sign in" link.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: link Privacy Policy and Terms of Service from login page"
```

---

## After this plan lands

Once deployed, use these as the OAuth consent screen's Branding fields
(`console.cloud.google.com/auth/branding?project=church-attendance-auth`):
- **Application privacy policy link:** `https://attendance.mannachurch.app/privacy`
- **Application terms of service link:** `https://attendance.mannachurch.app/terms`

This also resolves the earlier open question about where to find a Terms of
Service link — it's self-hosted now, no third-party link needed. The
**Application home page** and **Authorized domains** fields (using
`capitalarea.manna.church` / `manna.church`) are unaffected by this plan and
still need to be filled in separately, as discussed earlier in this session.
