# Help Page & Shared App Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for implementation.

**Goal:** Give every signed-in page the same three navigation anchors — app name (→ `/dashboard`), Help (deep-linked to the page's own section), Sign out — via a new shared `AppHeader` component, and give the app its first help content: a static, task-oriented `/help` page gated the same as every other signed-in page.

**Architecture:** One new server component, `src/components/AppHeader.tsx` (no data fetching, no role check — identical for every allowlisted user), rendered as a sibling immediately before `<main>` on `dashboard`, `entry/[eventId]`, `report/[eventId]`, `report/[eventId]/manage`, and `settings`. `SignOutButton` moves out of the dashboard's own header and into `AppHeader`; every other page gets a Sign-out control for the first time. One new page, `src/app/help/page.tsx`, gated by `requireUserPage()`, with hand-written copy under the spec's anchor ids as heading `id` attributes. `login` and `denied` are explicitly untouched (spec's explicit call — they sit outside the sign-in wall / are the sign-in wall itself).

**Tech Stack:** Next.js 16 App Router (Server Components), existing design tokens in `src/styles/tokens.css`, existing `no-print` convention in `src/styles/print.css`.

**Spec:** `docs/superpowers/specs/2026-08-31-help-and-header-design.md`

## Global Constraints

- `AppHeader` is a plain server component — no `'use client'`, no hooks, no `auth()`/`prisma` calls. It renders identically for every signed-in user by design (per spec: "which keeps it dumb and testable").
- `AppHeader` always carries `className="no-print"` on its root `<header>` — it is navigation chrome, not report content, and must vanish from the printed/PDF report exactly like `PrintButton`, the "Manage Records" link, and the "Download CSV" link already do (`src/styles/print.css` hides `.no-print` under `@media print`).
- **Placement, chosen and applied everywhere:** `<AppHeader .../>` renders as a sibling immediately *before* `<main>`, wrapped in a top-level `<>...</>` fragment — never nested inside `<main>`. Rationale: `AppHeader` is page chrome (a `<header>` landmark), not page content; nesting it inside `<main>` would put a nav-like landmark inside the content landmark, and it avoids touching each page's own `<main style={{ padding, maxWidth, margin }}>` wrapper, which is content layout, not chrome. Every task below applies this same shape — do not mix placements between pages.
- `helpAnchor` is a plain string prop (e.g. `"counting"`); the component builds `/help#<anchor>` itself. Omitting it (dashboard, and `/help` itself) falls back to a plain `/help` link.
- Report page keeps its own header (event name, speaker list, Manage Records / Download CSV / Print buttons) exactly as-is, inside `<main>`, below `AppHeader`. `AppHeader` is a second, higher strip — not a replacement for page-specific header content anywhere.
- `login` and `denied` get no `AppHeader` and no Help link — unchanged, per the spec's explicit non-goal (`/help` sits behind the sign-in wall enforced by `src/middleware.ts`; `denied`'s existing copy already tells an unauthorized visitor what to do).
- `/help` is gated by `requireUserPage()`, identically to every other signed-in page — content is the same for both roles. "(Admins)" in a heading is a text label, not a role check; nothing on the page is conditionally rendered by role.
- No new unit tests. This is pure UI composition (a presentational header) and static content — matches this project's existing convention for UI-wiring tasks (see `docs/superpowers/plans/2026-08-31-attendance-crud-plan.md` Task 4, and `docs/superpowers/plans/2026-08-17-csv-export-plan.md` Task 5).
- **Scope cut, called out explicitly per the task brief:** the spec's anchor table lists `#services` ("Creating and archiving services... lands with the settings redesign") and, within `#categories`, "reordering, renaming, hiding/showing, and deleting categories." Neither exists in the app today — confirmed by reading `src/lib/actions/events.ts` (`createEvent`/`archiveEvent` are implemented Server Actions but are not called from any page or form) and `src/app/settings/page.tsx` (the Categories section only wires an add form and a one-way "Retire" button — no reorder, rename, un-retire, or delete control anywhere). This plan therefore:
  - Does **not** add an `#services` section to `/help` at all — no anchor, no heading, nothing. It lands with the Phase 2e settings redesign, at which point that phase's plan adds it under the `#services` id the spec already reserved.
  - Writes `#categories` documenting only what `src/app/settings/page.tsx` does *today* — add a category, retire a category — and says plainly that reordering/renaming/un-retiring/deleting aren't available yet. The Phase 2e plan updates this section in place when those land; the anchor id does not change.

---

### Task 1: `AppHeader` component and wiring into the five existing signed-in pages

**Files:**
- Create: `src/components/AppHeader.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/entry/[eventId]/page.tsx`
- Modify: `src/app/report/[eventId]/page.tsx`
- Modify: `src/app/report/[eventId]/manage/page.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `SignOutButton` (`src/components/SignOutButton.tsx` — existing, unchanged, just re-homed), `next/link`.
- Produces: `AppHeader({ helpAnchor }: { helpAnchor?: string })` (exported from `src/components/AppHeader.tsx`) — consumed by every page in this task and by Task 2's `/help` page.

This task is pure UI composition with no new business logic — no red/green cycle. Verification is a type-check, the existing suite staying green, and the manual checklist in Task 3.

- [x] **Step 1: Create `AppHeader`**

Create `src/components/AppHeader.tsx`:

```tsx
import Link from 'next/link'
import { SignOutButton } from '@/components/SignOutButton'

/**
 * The one header every signed-in page shares. Deliberately role-independent
 * (no data fetching, no session check) — the app name, the Help link, and
 * Sign out are identical for every allowlisted user, so this stays a plain
 * server component with nothing to test beyond "does it render."
 *
 * `helpAnchor` scopes the Help link to the page's own section of /help
 * (e.g. "counting" -> /help#counting) so someone confused mid-task lands on
 * the relevant help, not the top of a long page. Omit it for a plain /help
 * link — used on the dashboard (no single section fits) and on /help itself.
 *
 * `no-print`: this strip is navigation chrome, not report content — it must
 * not appear in the printed/PDF version of a report. See src/styles/print.css,
 * which already hides .no-print under @media print for the report page's
 * own buttons.
 */
export function AppHeader({ helpAnchor }: { helpAnchor?: string }) {
  const helpHref = helpAnchor ? `/help#${helpAnchor}` : '/help'

  return (
    <header
      className="no-print"
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)',
      }}
    >
      <Link href="/dashboard" style={{ fontWeight: 700, color: 'var(--color-text)', textDecoration: 'none' }}>
        Church Attendance
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Link href={helpHref} style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Help
        </Link>
        <SignOutButton />
      </div>
    </header>
  )
}
```

- [x] **Step 2: Wire into the dashboard, and remove the old Sign-out placement**

`src/app/dashboard/page.tsx` currently renders its own `SignOutButton` inside a page-level `<header>`. That placement is removed — `AppHeader` is now the only Sign-out control anywhere. `helpAnchor` is omitted here on purpose: the dashboard lists every service and both entry points (Enter counts, Summary), so no single `/help` section fits better than the top of the page.

Change the imports from:

```tsx
import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { SignOutButton } from '@/components/SignOutButton'
import { ServiceCard } from '@/components/ServiceCard'
```

to:

```tsx
import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { AppHeader } from '@/components/AppHeader'
import { ServiceCard } from '@/components/ServiceCard'
```

Change the return statement from:

```tsx
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {user.role === 'ADMIN' && <Link href="/settings">Settings</Link>}
          <SignOutButton />
        </div>
      </header>
```

to:

```tsx
  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
          {user.role === 'ADMIN' && <Link href="/settings">Settings</Link>}
        </header>
```

and close the new fragment at the end of the file — change:

```tsx
      </ul>
    </main>
  )
}
```

to:

```tsx
      </ul>
      </main>
    </>
  )
}
```

(Re-indent the body between `<header>...</header>` and the closing tags by two spaces to match the new nesting — a plain visual re-indent, no logic changes. `npm run lint` in Step 6 below will catch anything missed.)

- [x] **Step 3: Wire into the entry page**

`src/app/entry/[eventId]/page.tsx` passes `helpAnchor="counting"` — the entry screen is exactly what `#counting` documents.

Add the import:

```tsx
import { AppHeader } from '@/components/AppHeader'
```

Change the return statement from:

```tsx
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
      <EntryClient eventId={eventId} categories={categories} initialCounts={counts} initialSpeakers={speakers} />
    </main>
  )
```

to:

```tsx
  return (
    <>
      <AppHeader helpAnchor="counting" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
        <EntryClient eventId={eventId} categories={categories} initialCounts={counts} initialSpeakers={speakers} />
      </main>
    </>
  )
```

- [x] **Step 4: Wire into the report page**

`src/app/report/[eventId]/page.tsx` passes `helpAnchor="reports"`. Its own header (event name, speakers, Manage Records / Download CSV / Print) stays exactly as it is, inside `<main>`, below the new `AppHeader` strip.

Add the import:

```tsx
import { AppHeader } from '@/components/AppHeader'
```

Change the return statement from:

```tsx
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
```

to:

```tsx
  return (
    <>
      <AppHeader helpAnchor="reports" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
```

and close the fragment at the end of the file — change the final:

```tsx
      </section>
    </main>
  )
}
```

to:

```tsx
      </section>
      </main>
    </>
  )
}
```

(As in Step 2, re-indent the body between the two changed lines by two spaces — visual only.)

- [x] **Step 5: Wire into the manage page and settings page**

`src/app/report/[eventId]/manage/page.tsx` passes `helpAnchor="manage"` — a direct match for `#manage`.

Add the import:

```tsx
import { AppHeader } from '@/components/AppHeader'
```

Change the return statement from:

```tsx
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>Manage attendance records</p>
      <ManageTable eventId={eventId} rows={tableRows} />
    </main>
  )
```

to:

```tsx
  return (
    <>
      <AppHeader helpAnchor="manage" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
        <p style={{ color: 'var(--color-text-muted)' }}>Manage attendance records</p>
        <ManageTable eventId={eventId} rows={tableRows} />
      </main>
    </>
  )
```

`src/app/settings/page.tsx` passes `helpAnchor="categories"`. **Judgment call, flagged rather than silently made:** Settings covers three help sections (`#categories`, `#access`, `#export`) and the spec doesn't say which one the page's single `helpAnchor` should point at. `#categories` is chosen because it's the first section on the page in reading order (Add a category, then Who can sign in, then Export) — someone arriving from Settings' Help link most plausibly wants the top of the page explained first, and `#access` / `#export` are one scroll away in the same `/help` page regardless. If this default turns out wrong in practice, it's a one-line change confined to this file.

Add the import:

```tsx
import { AppHeader } from '@/components/AppHeader'
```

Change the return statement from:

```tsx
  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>
```

to:

```tsx
  return (
    <>
      <AppHeader helpAnchor="categories" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>
```

and close the fragment at the end of the file — change the final:

```tsx
      </section>
    </main>
  )
}
```

to:

```tsx
      </section>
      </main>
    </>
  )
}
```

(As in the earlier steps, re-indent the body between the two changed lines by two spaces — visual only — in both `manage/page.tsx` and `settings/page.tsx`.)

- [x] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both clean. Lint will also catch any indentation left inconsistent by the re-indent steps above.

- [x] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all passing — this task adds no new tests but must not break anything existing (in particular, no existing test should be asserting on the dashboard's old inline `<header>`/`SignOutButton` structure; if one is, update it to reflect the new structure, not to preserve the old one).

- [x] **Step 8: Commit**

```bash
git add src/components/AppHeader.tsx "src/app/dashboard/page.tsx" "src/app/entry/[eventId]/page.tsx" "src/app/report/[eventId]/page.tsx" "src/app/report/[eventId]/manage/page.tsx" src/app/settings/page.tsx
git commit -m "feat: add shared AppHeader with Help deep-links and Sign out"
```

---

### Task 2: `/help` page with full content

**Files:**
- Create: `src/app/help/page.tsx`

**Interfaces:**
- Consumes: `requireUserPage()` (`src/lib/authz.ts`), `AppHeader` (Task 1).
- Produces: the `/help` route, target of every `AppHeader` Help link.

Pure static content — no red/green cycle. Verification is a type-check, the full suite staying green, and the manual deep-link checklist in Task 3.

- [x] **Step 1: Create the help page**

Create `src/app/help/page.tsx`. Content covers only what's actually shipped today (verified against `src/components/CounterDialog.tsx`, `src/components/SpeakerDialog.tsx`, `src/components/ManageTable.tsx`, `src/app/api/export/route.ts`, `src/app/settings/page.tsx`, and `src/lib/actions/attendance.ts`'s `getEventSummary`). No `#services` section — `createEvent`/`archiveEvent` exist in `src/lib/actions/events.ts` but aren't wired into any page yet; that section, and the reorder/rename/un-retire/delete parts of `#categories`, land with the Phase 2e settings redesign under the same anchor ids already reserved by the spec.

```tsx
import { requireUserPage } from '@/lib/authz'
import { AppHeader } from '@/components/AppHeader'

export default async function HelpPage() {
  // Content is identical for every allowlisted user — gated the same as
  // every other signed-in page, not because anything here is secret.
  await requireUserPage()

  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '40rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Help</h1>

        <section id="counting" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Counting attendance</h2>
          <p>
            On the dashboard, tap <strong>Start counting today&apos;s service</strong>. If no one has
            set up today&apos;s service yet, this creates it automatically — you don&apos;t need to
            wait for an admin.
          </p>
          <p>
            Tap a section on the sanctuary map, or a classroom, growth track, serve team, or
            ministry metric, to open its counter. Use the +1 / −1 buttons, or the +5 / +10 / +25
            shortcuts for a fast count. The count never goes below 0.
          </p>
          <p>
            Tap <strong>Save</strong> when you&apos;re done. It&apos;s safe to save more than
            once — tapping Save twice, or two volunteers both counting the same room, never
            doubles the number. Each save simply overwrites with the latest count.
          </p>
          <p>
            If your phone loses signal or the tab closes before you save, your unsaved tally
            stays on that device and comes back the next time you open that counter — nothing is
            lost.
          </p>
          <p>
            Ministry Metrics (things like Salvations) use the same counter as everything else,
            but they&apos;re tracked separately — see <a href="#reports">Reports</a> for what
            does and doesn&apos;t count toward the Total.
          </p>
        </section>

        <section id="speakers" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Recording who&apos;s speaking</h2>
          <p>
            On the entry screen&apos;s sanctuary map, tap the stage to open the Speakers list for
            that service.
          </p>
          <p>
            Type a name and tap <strong>Add</strong>. Adding the same name twice is simply
            ignored, not added as a duplicate. Tap <strong>Remove</strong> next to a name to take
            them off the list.
          </p>
          <p>Speakers recorded for a service also appear at the top of that service&apos;s report.</p>
        </section>

        <section id="reports" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Reading the summary and printing</h2>
          <p>
            Tap <strong>Summary</strong> on a service, from the dashboard or the entry screen, to
            see its report. Counts are grouped by Sanctuary, Classrooms, Growth Track, Serve
            Teams, and Ministry Metrics.
          </p>
          <p>
            The Total adds Sanctuary + Classrooms + Growth Track + Serve Teams. Ministry Metrics
            (like Salvations) are shown on the report but are never added into the Total — they
            measure something other than attendance.
          </p>
          <p>
            Tap <strong>Print summary</strong> for a clean, paper-friendly copy — buttons, links,
            and this header are hidden automatically when you print.
          </p>
          <p>
            From the dashboard, tapping a service&apos;s row (not the Enter counts / Summary
            links) expands the same five totals right there, without leaving the dashboard.
          </p>
        </section>

        <section id="manage" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Manage Records (Admins)</h2>
          <p>
            From a service&apos;s report page, admins see a <strong>Manage Records</strong> link.
            It lists every category relevant to that service — including ones with no count yet,
            and, rarely, a retired category that still has an old count on it.
          </p>
          <p>
            <strong>Edit</strong> reopens the same +/− counter used on the entry screen, saved the
            same safe, repeat-proof way.
          </p>
          <p>
            <strong>Delete</strong> permanently removes that category&apos;s count for this
            service — it doesn&apos;t reset it to 0, it removes the record entirely, so the
            category goes back to showing as unrecorded. You&apos;ll be asked to confirm first,
            and it can&apos;t be undone from the app once you do.
          </p>
        </section>

        <section id="categories" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Categories (Admins)</h2>
          <p>
            In Settings, <strong>Add a category</strong> creates a new Section, Classroom, Growth
            Track, Serve Team, or Ministry Metric, which appears on the entry screen right away.
          </p>
          <p>
            A category&apos;s position on the sanctuary map is fixed when it&apos;s created. A
            category not tied to a map position still works fine — it just appears as a list row
            instead of a map tap-target.
          </p>
          <p>
            <strong>Retire</strong> hides a category from new counting without deleting its
            history — past reports and CSV exports still show whatever was recorded for it before
            it was retired.
          </p>
          <p>
            Renaming, reordering, un-retiring, and deleting a category outright aren&apos;t
            available yet — that&apos;s coming in a future update.
          </p>
        </section>

        <section id="access" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Who can sign in (Admins)</h2>
          <p>
            In Settings under <strong>Who can sign in</strong>, add the Google email address you
            want to authorize and choose a role — Volunteer or Admin.
          </p>
          <p>
            Only addresses on this list can sign in at all. An email that isn&apos;t listed lands
            on the &quot;Access denied&quot; page.
          </p>
          <p>
            <strong>Revoke</strong> takes effect immediately — the very next action that person
            tries (not just their next sign-in) is refused, because every save, report, and
            setting change re-checks this list on the server. There&apos;s no waiting for a login
            session to expire.
          </p>
          <p>
            Admins see everything a Volunteer sees, plus Settings, Manage Records, and CSV
            export. Volunteers can count attendance and view reports.
          </p>
        </section>

        <section id="export" className="card">
          <h2 style={{ marginTop: 0 }}>CSV downloads (Admins)</h2>
          <p>There are two ways to download attendance data as a CSV:</p>
          <p>
            <strong>Download CSV</strong> on a single service&apos;s report page downloads just
            that service.
          </p>
          <p>
            <strong>Export attendance data</strong> in Settings downloads every service between a
            start and end date you choose, all in one file — including archived services, since
            archiving hides a service from new counting but doesn&apos;t erase its history.
          </p>
          <p>
            Each row in the file is one category&apos;s count for one service: the service date
            and name, the category&apos;s type and name, the count, whether it counts toward the
            Total, and who recorded it.
          </p>
          <p>
            If a service has recorded speakers, they appear as extra rows after its counts —
            marked <strong>SPEAKER</strong> in the type column, with the person&apos;s name in
            the Category column and an empty count.
          </p>
        </section>
      </main>
    </>
  )
}
```

- [x] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all passing.

- [x] **Step 4: Commit**

```bash
git add src/app/help/page.tsx
git commit -m "feat: add /help page with task-oriented sections"
```

---

### Task 3: Full-suite verification and manual sign-off

**Files:** none (verification only — no commit at the end of this task unless a check below turns up a fix that needs one).

- [x] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [x] **Step 2: Full test suite**

```bash
npm test
```

Expected: all specs passing.

- [x] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual verification**

Start the dev server, sign in as admin:

1. Confirm `AppHeader` (app name, Help, Sign out) appears, identically styled, at the top of all six signed-in pages: `/dashboard`, `/entry/<eventId>`, `/report/<eventId>`, `/report/<eventId>/manage`, `/settings`, `/help`.
2. From any non-dashboard page, tap the app name — confirm it navigates to `/dashboard`.
3. Confirm Help deep-links land on the right section, scrolled into view:
   - From `/entry/<eventId>` → `/help#counting`.
   - From `/report/<eventId>` → `/help#reports`.
   - From `/report/<eventId>/manage` → `/help#manage`.
   - From `/settings` → `/help#categories`.
   - From `/dashboard` → `/help` (top of page, no scroll).
4. From a non-dashboard page (e.g. `/settings` or `/help`), tap **Sign out**. Confirm it signs out and lands on `/login`.
5. Confirm `/login` and `/denied` are unchanged — no `AppHeader`, no Help link, no Sign out.
6. On `/report/<eventId>`, open the browser's print preview. Confirm the `AppHeader` strip does not appear, alongside the existing Manage Records / Download CSV / Print buttons that are already hidden.
7. On `/dashboard`, confirm exactly one Sign-out control exists (in `AppHeader`) — the old page-level one is gone — and the admin-only Settings link still appears next to the "Services" heading for an admin account, and not at all for a volunteer account.
8. Sign in as a VOLUNTEER-role account (or reason through the code if a second test account isn't available): confirm `/help` renders in full, including every "(Admins)" section — nothing on the page is hidden by role — while the volunteer still doesn't see the Manage Records / Settings / CSV links on the pages those sections describe.
9. Visit `/help` directly while signed out: confirm `src/middleware.ts` redirects to `/login` exactly as it does for every other non-public route.

If any step fails, fix the underlying issue, re-run Steps 1–3, and repeat the failed manual step before considering this plan complete.
