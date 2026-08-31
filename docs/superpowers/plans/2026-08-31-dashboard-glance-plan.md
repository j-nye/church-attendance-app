# Dashboard At-a-Glance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for implementation.

**Goal:** Let anyone on the dashboard tap a service card to expand a **read-only** at-a-glance view of its recorded totals (Sanctuary, Classrooms, Growth Track, Serve Teams, Total) directly in the list — the same five numbers as the report page's totals card — without leaving the dashboard or opening the full report.

**Architecture:** The dashboard's event `<li>` markup moves into a new Client Component, `ServiceCard`. Its header becomes a toggle button (`aria-expanded`, chevron) that, on first expand only, lazy-fetches the service's totals via the **existing** `getEventSummary` Server Action and caches the result in component state — collapsing and re-expanding never refetches. `src/app/dashboard/page.tsx` stays a Server Component: it keeps doing the auth gate and `listEvents()` call exactly as before, and now maps each event to plain serializable props (`id`, `name`, a pre-formatted `serviceDate` string) for `ServiceCard`. No server-side code changes of any kind — `getEventSummary`, `listEvents`, and every other Server Action are untouched.

**Tech Stack:** Next.js 16 App Router (Server Components + a Client Component), React 19, TypeScript. No Prisma/Zod/migration work — this plan touches no server code.

**Spec:** `docs/superpowers/specs/2026-08-31-dashboard-glance-design.md`

## Global Constraints

- No server-side changes of any kind: `getEventSummary`, `listEvents`, `src/lib/actions/*.ts`, and `prisma/schema.prisma` are all out of scope. This is pure UI wiring around an already-tested Server Action.
- The toggle button and the "Enter counts"/"Summary" links are siblings, never nested — a link inside a `<button>` is a nested-interactive accessibility violation, and the spec requires both links to keep working as separate tap targets.
- Lazy-fetch on first expand only. `ServiceCard` tracks fetch state as `'idle' | 'loading' | 'loaded' | 'error'`, starting at `'idle'`; the fetch only fires when `status === 'idle'`, so a later collapse/re-expand cycle — which only ever toggles a separate `expanded` boolean — never re-triggers it. The one exception is the error state's explicit "Try again" button, which re-enters `loadSummary()` directly.
- Loud error convention, matching `CounterDialog`: `role="alert"`, `--color-danger`, a `⚠` icon, and a visible retry affordance — never a silently-swallowed failure. `getEventSummary` throwing for a nonexistent event is handled by the same generic `catch` as any other fetch failure; no special-casing.
- The expansion is read-only by construction: it renders numbers only, no buttons, inputs, or links anywhere inside it.
- No new automated tests — this is UI wiring around an already-tested Server Action (`getEventSummary` has full coverage in `tests/actions-attendance.test.ts`), matching this project's convention for pure UI composition tasks (see `docs/superpowers/plans/2026-08-31-attendance-crud-plan.md` Task 4, itself citing `docs/superpowers/plans/2026-08-17-csv-export-plan.md` Task 5). Verification is a type-check, the full existing suite staying green, and a manual checklist.

---

### Task 1: `ServiceCard` component

**Files:**
- Create: `src/components/ServiceCard.tsx`

**Interfaces:**
- Consumes: `getEventSummary(eventId: string)` (`src/lib/actions/attendance.ts` — existing, unchanged; called directly from a Client Component, matching the established pattern in `src/components/ManageTable.tsx`).
- Produces: the `ServiceCard` component (exported from `src/components/ServiceCard.tsx`), taking `{ id: string; name: string; serviceDate: string }` — consumed by Task 2's dashboard page.

This task is UI wiring around an already-tested Server Action — no red/green test cycle, per the Global Constraints above.

- [x] **Step 1: Create `ServiceCard`**

Create `src/components/ServiceCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getEventSummary } from '@/lib/actions/attendance'

/** Derived from getEventSummary's own return type, so this never drifts out
 * of sync with the server-side shape it's rendering. */
type Totals = Awaited<ReturnType<typeof getEventSummary>>['totals']

type FetchStatus = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * A dashboard service list item. The header is a toggle button that expands
 * a READ-ONLY at-a-glance view of the service's recorded totals — the same
 * five numbers as the report page's totals card. Totals are lazy-fetched on
 * first expand only and cached in state: collapsing and re-expanding never
 * refetches.
 *
 * The "Enter counts" and "Summary" links are siblings of the toggle button,
 * never nested inside it — a link inside a <button> is an accessibility
 * violation (nested interactive content) and both links must keep working
 * as their own tap targets.
 */
export function ServiceCard({ id, name, serviceDate }: { id: string; name: string; serviceDate: string }) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<FetchStatus>('idle')
  const [totals, setTotals] = useState<Totals | null>(null)

  async function loadSummary() {
    setStatus('loading')
    try {
      const { totals } = await getEventSummary(id)
      setTotals(totals)
      setStatus('loaded')
    } catch {
      // Loud, not silent — matches CounterDialog's error handling for saves.
      // getEventSummary throwing for a nonexistent event lands here too;
      // there's nothing more specific to say to the viewer in either case.
      setStatus('error')
    }
  }

  function toggle() {
    setExpanded((prev) => !prev)
    // Lazy-fetch on first expand only — status only ever leaves 'idle' here,
    // so a later collapse/re-expand cycle (which only flips `expanded`)
    // never re-triggers this fetch. A failed fetch is retried only via the
    // explicit "Try again" button below, which calls loadSummary() directly.
    if (status === 'idle') {
      loadSummary()
    }
  }

  return (
    <li className="card" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
          padding: 0, background: 'none', border: 'none', font: 'inherit', color: 'inherit',
          textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div>
          <strong>{name}</strong>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{serviceDate}</div>
        </div>
        <div
          aria-hidden="true"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)',
            color: 'var(--color-text-muted)',
          }}
        >
          ▾
        </div>
      </button>

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
        <Link href={`/entry/${id}`}>Enter counts</Link>
        <Link href={`/report/${id}`}>Summary</Link>
      </div>

      {expanded && (
        <div
          style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}
        >
          {status === 'loading' && <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading…</p>}

          {status === 'error' && (
            <div
              role="alert"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-danger)' }}
            >
              <span aria-hidden="true">⚠</span>
              <span>Could not load counts.</span>
              <button type="button" onClick={loadSummary}>
                Try again
              </button>
            </div>
          )}

          {status === 'loaded' && totals && (
            <table style={{ width: '100%' }}>
              <tbody>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Sanctuary</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.sanctuary}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Classrooms</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.classrooms}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Growth Track</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.growthTrack}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Serve Teams</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.serveTeams}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{totals.grand}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  )
}
```

Note: a zero-count service needs no special-casing — `getEventSummary` succeeds with an empty `records` array, so every `totals` field is already `0`, and the table above renders that directly. That's itself the at-a-glance answer ("nobody has counted yet"), per the spec.

- [x] **Step 2: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all passing — this task adds no new tests but must not break anything existing.

- [x] **Step 4: Commit**

```bash
git add src/components/ServiceCard.tsx
git commit -m "feat: add ServiceCard component with lazy-loaded at-a-glance totals"
```

---

### Task 2: Wire the dashboard to `ServiceCard`

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `ServiceCard` (Task 1), `formatServiceDate` (`src/lib/dates.ts` — existing, already imported in this file).
- Produces: nothing new — pure UI wiring, replacing the inline `<li>` markup with `ServiceCard` instances.

This task is UI wiring — no red/green test cycle, per the Global Constraints above. The header (`h1`, Settings link, `SignOutButton`) and the "Start counting today's service" form (`getOrCreateTodayEvent`) are untouched.

- [x] **Step 1: Replace the inline list markup**

In `src/app/dashboard/page.tsx`, add the import:

```ts
import { ServiceCard } from '@/components/ServiceCard'
```

Change the events list from:

```tsx
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-8)' }}>
        {events.map((event) => (
          <li key={event.id} className="card" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <strong>{event.name}</strong>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              {formatServiceDate(event.serviceDate)}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
              <Link href={`/entry/${event.id}`}>Enter counts</Link>
              <Link href={`/report/${event.id}`}>Summary</Link>
            </div>
          </li>
        ))}
      </ul>
```

to:

```tsx
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-8)' }}>
        {events.map((event) => (
          <ServiceCard
            key={event.id}
            id={event.id}
            name={event.name}
            serviceDate={formatServiceDate(event.serviceDate)}
          />
        ))}
      </ul>
```

`formatServiceDate` runs here, server-side, exactly as it did before — `ServiceCard` only ever receives the already-formatted display string, matching the spec's "plain serializable only" prop contract (`id`, `name`, `serviceDate: string`).

- [x] **Step 2: Run a type-check**

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
git add src/app/dashboard/page.tsx
git commit -m "feat: wire dashboard service list to expandable ServiceCard"
```

---

### Task 3: Full-suite verification and manual sign-off

**Files:** none (verification only — no commit at the end of this task unless a check below turns up a fix that needs one).

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all specs passing — this plan adds none, but nothing existing may regress.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual verification**

Start the dev server, sign in (matches the spec's Testing section verbatim):

1. Open `/dashboard`. Confirm each service card shows its name, date, a chevron, and the "Enter counts"/"Summary" links as before.
2. Tap a card with recorded counts to expand it. Confirm a brief "Loading…" appears, then the five totals (Sanctuary, Classrooms, Growth Track, Serve Teams, Total) match that service's `/report/<eventId>` totals card exactly — same numbers, same order, Total emphasized.
3. Tap an uncounted service's card. Confirm it expands to all zeros rather than an error.
4. Collapse and re-expand an already-loaded card. Confirm the totals reappear immediately with no "Loading…" flicker (no refetch).
5. Tap "Enter counts" and "Summary" on a card, both collapsed and expanded. Confirm both links still navigate correctly and neither tap accidentally toggles the card's expansion.
6. Simulate a fetch failure (e.g. throttle/offline the network in dev tools, or temporarily point at a bad `eventId`) and expand a card. Confirm the loud error state appears (`⚠`, red text, "Try again") and that clicking "Try again" retries and can recover into the normal loaded state.
7. Sign in as a VOLUNTEER-role account (or reason through the code if a second test account isn't available): confirm the expansion behaves identically to an admin's — same totals, same read-only rendering, no extra controls.

If any step fails, fix the underlying issue, re-run Steps 1–3, and repeat the failed manual step before considering this plan complete.
