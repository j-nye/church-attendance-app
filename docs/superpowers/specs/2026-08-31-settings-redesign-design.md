# Settings redesign: category manager & service controls

**Date:** 2026-08-31
**Status:** Approved, pending implementation plan

## Motivation

The Settings page grew field-by-field around the schema, not around the admin's task.
Adding a category means decoding a type dropdown; the map-region picker shows even where
it's meaningless; **reordering is impossible** (every new category gets `sortOrder: 0` and
nothing ever edits it); **renaming and un-retiring are impossible** (`renameCategory` and
`reactivateCategory` were deleted as unused in `d22dd23`); and a category created by typo
can never be removed. Separately, the roadmap's Phase 3 promised create/archive controls
for services that never got a home. This spec redesigns Settings around both.

## Decisions (2026-08-31)

- **`type` and `countsTowardTotal` become editable, behind an explicit warning.** This
  deliberately reverses the 2026-08-17 parity/redesign spec's immutability non-goal, by
  owner decision. The warning must say plainly that the change rewrites how ALL past
  reports group and total this category (totals are computed live from these fields).
- **Delete-if-unused**: hard delete is offered only for a category with zero attendance
  records; anything with history can only be hidden. (DB `onDelete: Restrict` backstops.)
- **Reordering via up/down buttons**, not drag-and-drop — touch-reliable, keyboard
  accessible, no new dependency.
- Shared header/help are a separate spec (`2026-08-31-help-and-header-design.md`).

## Category manager

### Layout

One section per category type, in the entry screen's order and with its labels
(`TYPE_LABELS`): Sanctuary, Classrooms, Growth Track, SERVE Team, Ministry Metrics.
Each section shows its **active** categories ordered by `sortOrder`, then a
"Hidden (n)" disclosure collapsing its inactive ones, then a contextual **+ Add** control.

### Add (per section)

The add form lives inside its section, so **type is inferred — no type dropdown**.
Fields by section: name (always); map region picker (Sanctuary sections only; regions
already assigned to an active category are marked as taken); "Counts toward Total
Attendance" checkbox (shown only in Ministry Metrics, where unchecked is the norm —
elsewhere it silently defaults true). New categories get `sortOrder = max(sortOrder of
active same-type categories) + 1` (computed server-side in `createCategory`) so they land
at the end of their section instead of all colliding at 0. Reuses the Phase 2
`createCategoryAction`/`useActionState` inline-error pattern (adapted so the wrapper takes
the section's fixed type).

### Per-row actions (active rows)

In order of destructiveness:

1. **↑ / ↓** — `moveCategory({ id, direction })`: swaps `sortOrder` with the adjacent
   *active* category of the same type, both writes in one transaction. First/last rows
   render the impossible direction disabled. Includes a one-time normalization: the
   implementation renumbers each type's existing categories (0,1,2…) in the seed/migration
   step so pre-existing ties on 0 don't make swaps ambiguous.
2. **Rename** — inline edit; re-adds `renameCategory({ id, name })`. Safe: records
   reference the id, history follows the name. Duplicate name+type → the inline P2002
   message pattern from Phase 2.
3. **Edit** — a small dialog exposing map region (Sanctuary), and — behind the warning —
   `type` and `countsTowardTotal`, via a new `updateCategory` action. Changing type away
   from SECTION clears `svgKey` server-side. The warning is a required confirmation step
   in the dialog (checkbox or confirm screen: "This changes how every past report groups
   and totals this category"), not a `window.confirm`.
4. **Hide** — existing `deactivateCategory`, relabeled from "Retire". Row moves into the
   section's Hidden disclosure.
5. **Show** (hidden rows) — re-adds `reactivateCategory(id)`; row returns to the end of
   the active list (gets `max + 1` sortOrder, same rule as add).
6. **Delete** (only rendered when the category has zero attendance records — the server
   sends a per-row `recordCount` or `hasRecords` flag) — new `deleteCategory(id)` action:
   `requireAdmin()`, re-checks `attendanceRecord.count === 0` server-side, rejects with a
   friendly message otherwise, hard-deletes. Confirmed via the same warning-dialog pattern
   as Edit (not `window.confirm` — this page is getting real interaction patterns).

All actions: `requireAdmin()` first, Zod-parsed input, `revalidatePath('/settings')` (and
`/entry/*`-relevant paths where ordering/visibility changes what volunteers see — the
plan enumerates them), unit tests per action.

## Service controls (absorbs roadmap Phase 3's UI item)

A "Services" section on Settings, above or beside the category manager:

- **Create a service**: name + date (defaults to next Sunday church-local — see
  `src/lib/dates.ts`), calling the existing `createEvent`, with the inline-error pattern
  (duplicate `[serviceDate, name]` → friendly message).
- **Recent services list** (reuse `listEvents`-style query but including archived, capped):
  each row shows name, date, archived state, and:
  - **Archive** (active rows) — existing `archiveEvent`, warning-dialog confirmed ("an
    archived service stops accepting counts and edits").
  - **Unarchive** (archived rows) — new `unarchiveEvent(id)` action, symmetric with
    hide/show philosophy: a mistaken archive must be reversible from the UI.

The `getOrCreateTodayEvent` race fix stays a separate roadmap item (Phase 3, unchanged).

## Testing

- Unit tests for every new/re-added action: `moveCategory` (swap correctness, boundary
  rows, cross-type isolation, transaction), `renameCategory` (P2002 path),
  `updateCategory` (svgKey clearing on type change), `reactivateCategory` (sortOrder
  reassignment), `deleteCategory` (refuses when records exist — both the flag path and a
  race where a record appears between render and click), `unarchiveEvent`, and the
  `createCategory` sortOrder = max+1 change.
- UI wiring untested per convention; the plan carries a thorough manual checklist.

## Non-goals / out of scope

- No drag-and-drop.
- No audit trail for category/service changes (delete-if-unused destroys no counts;
  `AuditLog.priorCount` doesn't fit this shape). Revisit only if it bites.
- No bulk operations.
- No changes to the allowlist or export sections beyond inheriting the page's new layout.
- No renumbering UI — order is expressed only through the arrows.
