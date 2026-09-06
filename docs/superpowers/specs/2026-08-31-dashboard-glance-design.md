# Dashboard at-a-glance counts

**Date:** 2026-08-31
**Status:** Approved, pending implementation plan

## Motivation

The dashboard lists services but tells you nothing about them — to see whether counting has
happened (or what the room looked like) you must open the full report. Requested: click a
service card to expand a **read-only** at-a-glance view of its recorded counts, directly in
the list. No editing from this view — the entry screen stays the only place counts change.

**Decision (2026-08-31):** the expansion shows **group totals + grand total** only
(Sanctuary, Classrooms, Growth Track, Serve Teams, Total) — the same five numbers as the
report page's totals card. Per-category detail stays one tap away via the existing
"Summary" link.

## Design

### Data

No new server code. `getEventSummary(eventId)` in `src/lib/actions/attendance.ts` already
returns exactly the needed `totals` object, is volunteer-callable (`requireUser()`), and
masks `recordedBy` for volunteers (irrelevant here — the expansion renders only totals).
The expansion **lazy-fetches on first open**: the dashboard lists up to 50 services, and
eagerly fetching 50 summaries to render a list would be waste. Once fetched, the result is
kept in component state — collapsing and re-expanding does not refetch.

### UI

- The dashboard's event list items move into a new client component (e.g.
  `src/components/ServiceCard.tsx`). The card's header area becomes a toggle button
  (`aria-expanded`, chevron affordance) — the existing "Enter counts" and "Summary" links
  remain separate tap targets and keep working unchanged.
- Expanded content: five rows (Sanctuary / Classrooms / Growth Track / Serve Teams /
  Total), Total emphasized, matching the report totals card's order and labels. Numbers
  right-aligned, muted styling — visibly informational, with no buttons or inputs
  anywhere in the expansion (read-only by construction, for volunteers and admins alike).
- While loading: a brief inline "Loading…" state. On fetch failure: the codebase's loud
  error convention — `role="alert"`, `--color-danger` + `⚠` icon, with a "Try again"
  affordance (no silent failure).
- A service with no recorded counts shows all zeros — which is itself the at-a-glance
  answer ("nobody has counted yet").

### Server component boundary

`src/app/dashboard/page.tsx` stays a server component (auth gate, `listEvents`); it maps
events to plain serializable props (`id`, `name`, `serviceDate` — the already-formatted
display string) for `ServiceCard`.

## Testing

- No new server-action tests (`getEventSummary` is already covered).
- Component-level behavior is UI wiring per project convention — verified manually:
  expand a counted service (totals match its report page), expand an uncounted one
  (zeros), collapse/re-expand (no refetch flicker), links still navigate, volunteer
  sees the same read-only expansion.

## Non-goals / out of scope

- No editing from the dashboard — not even for admins.
- No per-category rows in the expansion (revisit only if the totals prove insufficient).
- No eager prefetch of summaries, and no caching beyond component state.
- No change to `listEvents`, `getEventSummary`, or any server action.
