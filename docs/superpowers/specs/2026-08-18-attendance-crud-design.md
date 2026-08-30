# Full CRUD for attendance records

**Date:** 2026-08-18
**Status:** Approved, pending implementation plan

## Motivation

The second half of a two-part request (CSV export shipped first, as its own spec/plan). Today `AttendanceRecord` has exactly one mutation path — `saveCount`, an upsert keyed on `(eventId, categoryId)` that already covers Create and Update in one call. There is no way to delete a record anywhere in the app. This spec adds Delete, plus a dedicated admin surface (Read) for reviewing and correcting a service's records in one place, rather than one category at a time through the volunteer-facing tap-counter.

## What "CRUD" means here

- **Create / Update:** already fully handled by the existing `saveCount` action. Unchanged by this spec.
- **Read:** a new admin-only query, `getManageRows(eventId)`, returning one row per category relevant to a service.
- **Delete:** genuinely new — a hard delete of a specific `AttendanceRecord` row, removing that fact entirely (the category reverts to unrecorded, `—`, not a recorded `0`). This is the one truly irreversible action anywhere in this app; everything else (categories, allowlist entries) is soft-delete/retire.

## Access control

Delete is **admin-only**, matching every other destructive/administrative action in this app (retiring categories, revoking allowlist entries). A volunteer can already correct their own mistake by re-entering a value through the existing tap-counter — delete is for removing a record outright, a bigger and less common action.

Both new functions call `requireAdmin()` independently, matching this codebase's established convention that every layer re-checks its own boundary rather than trusting a page-level gate.

**Archived services are out of scope for editing.** `deleteCount` rejects an archived event with the same message `saveCount` already uses for the same case — no new rule, no exception carved out. Editing historical, closed-out numbers after the fact would undermine the reason the service was archived.

## Server actions

Both added to `src/lib/actions/attendance.ts`, alongside the existing `saveCount`, `getEventCounts`, `getEventSummary`, and `getExportRows`.

### `getManageRows(eventId: string)`

`requireAdmin()`, then returns the **union** of:
1. Every currently-active category applicable to the event (mirrors what the entry screen shows).
2. Any category that has an existing `AttendanceRecord` for this event, even if that category has since been retired.

The union matters: without it, a stray record tied to a category an admin later retired would become invisible to this page — the only way to find and clean it up would be a raw database query, defeating the purpose of building an admin CRUD view at all.

Each row: `{ categoryId, categoryName, categoryType, count, recordedBy, updatedAt }`. For an unrecorded active category, `count`/`recordedBy`/`updatedAt` are all `undefined`.

### `deleteCount({ eventId, categoryId }: { eventId: string; categoryId: string })`

`requireAdmin()`, rejects if the event is archived (same message as `saveCount`'s existing check), then:

```ts
await prisma.attendanceRecord.deleteMany({ where: { eventId, categoryId } })
```

`deleteMany`, not `delete` — a double-click race (the record already gone by the time the second click's request lands) becomes a harmless no-op instead of a thrown `P2025` "record not found" error.

Revalidates three paths on success: `/entry/<eventId>` (the volunteer tap-counter needs to show `—` again), `/report/<eventId>` (totals change), and `/report/<eventId>/manage` (the page itself).

## UI

### New route: `/report/<eventId>/manage`

`src/app/report/[eventId]/manage/page.tsx` — `requireAdmin()` at the page level (convenience gate, same pattern the Settings page already uses; the real boundary is in the two server actions above). Fetches the event and `getManageRows(eventId)`, renders `ManageTable`.

### New component: `src/components/ManageTable.tsx`

One row per category: name, type, count (or `—`), recorded-by (or `—`), updated-at (or `—`), and actions.

- **Edit** — always available. Opens the existing `CounterDialog` (the same `+`/`-`/`+5`/`+10`/`+25` modal volunteers already use), pre-filled with the current count (or `0` for an unrecorded category), calling the existing `saveCount`. No new save logic anywhere — Create and Update for this view are both already fully handled by what exists today; this task only opens that dialog from a new table row instead of a map/list tap.
- **Delete** — only rendered when a record exists (nothing to delete for an unrecorded category). Confirms via a plain `window.confirm()` before calling `deleteCount`. Deliberately not a custom styled modal: this is the only confirmation needed anywhere in the app, and a new generic confirm-dialog component for one button is more engineering than the moment calls for. Accepted trade-off: it won't match the app's accessible/colorblind-safe styling the way `CounterDialog` does.

### Entry point

A "Manage Records" link on `/report/<eventId>`, admin-only (same conditional as the existing Download CSV link), alongside Download CSV and Print.

## Error handling

- Non-admin hitting `/report/<eventId>/manage` directly → `AuthzError('FORBIDDEN')`, same pattern as every other admin-only page.
- `deleteCount` on an archived event → rejected, same message as `saveCount`'s existing archived-event check.
- `deleteCount` on an already-deleted record → silent no-op via `deleteMany`, not an error.

## Testing

- `tests/actions-attendance.test.ts` (extended):
  - `getManageRows` — requires admin; an active category with no record produces `undefined` fields; a retired category with an existing record still appears; an active category with a record has both populated; confirms the union logic with a case exercising all three.
  - `deleteCount` — requires admin; rejects an archived event with the expected message; calls `deleteMany` with the exact compound key; a call where nothing matches doesn't throw.
- Manual verification: admin creates a record via Manage Records' Edit action, edits an existing one, deletes one and confirms it reverts to `—` on both the manage page and the entry screen (not just the manage page), and confirms a signed-in volunteer can't reach the page or trigger either action directly.

## Non-goals / out of scope

- No audit trail of edits or deletes beyond what already exists (`recordedBy`/`updatedAt` on the current record) — a deleted record's prior state is not retained anywhere.
- No bulk delete (a whole service's records at once) — one record at a time, matching the one-row-at-a-time table design.
- No relaxing of the archived-event write restriction — editing/deleting stays scoped to active services only.
- No new confirmation-modal component — `window.confirm()` is a deliberate, accepted trade-off for this one action.
- No ownership-based ("delete your own records") authorization model — delete stays role-based (admin-only), matching every other destructive action in this app.
