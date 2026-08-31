# CSV export for attendance data

**Date:** 2026-08-17
**Status:** Shipped (2026-08-17 plan fully implemented plus review hardening in 55c889f)

## Motivation

The user asked for two features: CSV export and full CRUD for attendance records. These are independent (export is read-only reporting, CRUD touches mutation/authorization) and were deliberately decomposed into two specs, built one at a time. This spec covers export only. CRUD gets its own spec afterward.

Within export, the user wanted both a single-service download (matching the existing `/report/<eventId>` page) and a date-range download across multiple services. These were combined into one spec because they share the same underlying query and CSV-generation logic — the range export is the single-service export's query looped over multiple events, not a different feature.

## CSV format

**Columns, in order:** `Service Date, Service Name, Archived, Category Type, Group, Category, Count, Counts Toward Total, Recorded By`

- `Service Date` — raw `YYYY-MM-DD` string, as stored on `Event.serviceDate`.
- `Service Name` — `Event.name`.
- `Archived` — `true`/`false`, from `Event.isArchived`. Lets a spreadsheet filter/pivot on archived vs. active services.
- `Category Type` — the raw `CategoryType` enum value (`SECTION`, `CLASSROOM`, `GROWTH_TRACK`, `SERVE_TEAM`, `SERVICE_METRIC`), as selected in the admin "Add a category" form's type dropdown.
- `Group` — the human-readable label for the same value, via the report page's existing `TYPE_LABELS` map (e.g. `SECTION` → `Sanctuary`). Kept alongside the raw type rather than replacing it, per explicit request.
- `Category` — `Category.name`.
- `Count` — `AttendanceRecord.count`.
- `Counts Toward Total` — literal `true`/`false`, from `Category.countsTowardTotal`.
- `Recorded By` — `AttendanceRecord.recordedBy` (the volunteer's email). Always present, unconditionally — see Access Control below for why this differs from the on-screen report page's admin-only masking of the same field.

**Row shape:** long format — one row per (service, category) pair. A single-service export is every active-at-the-time category for that one event; a range export is the same rows for every event whose `serviceDate` falls within the requested range, concatenated.

**Empty results:** a valid range with zero matching events still returns a 200 with a well-formed CSV containing only the header row — not an error.

**File naming** (via `Content-Disposition: attachment; filename="..."`):
- Single-service: `attendance-<serviceDate>.csv`
- Range: `attendance-<start>-to-<end>.csv`

## Access control

The entire export endpoint is restricted to `ADMIN` role — not just visibility of the download button, the route handler itself calls `requireAdmin()` before doing anything else, matching the pattern every other admin-only action in this codebase already follows (e.g. `createCategory`, `deactivateCategory`).

Because of this, `Recorded By` does NOT need the conditional per-row masking `getEventSummary()` applies for the on-screen `/report` page (where a signed-in volunteer can view the page, so `recordedBy` is hidden from non-admins at the row level). Since a non-admin can never reach the export endpoint at all, the column is simply always present in the CSV — this is a deliberate simplification from the report page's existing rule, not an oversight.

## Architecture

**New files:**
- `src/lib/csv.ts` — `toCsv(columns: string[], rows: Record<string, string>[]): string`. Dependency-free (no new npm package). `columns` is an explicit, caller-supplied ordered list — NOT inferred from `rows[0]`'s keys, specifically so a zero-row call still produces a correct header-only CSV (inferring from the first row would have no header to fall back on when `rows` is empty, which would silently contradict the "empty results" requirement below). RFC4180-escapes every field (wraps in quotes if it contains a comma, quote, or newline; doubles internal quotes), joins with CRLF per the RFC. The route handler always calls it with the fixed 9-element column list from "CSV format" above.
- `src/app/api/export/route.ts` — GET Route Handler. Calls `requireAdmin()` first. Accepts either `?eventId=<id>` (single service) or `?start=YYYY-MM-DD&end=YYYY-MM-DD` (range) — exactly one mode per request; neither or both present is a 400. Builds rows via `getExportRows`, formats via `toCsv`, returns a `Response` with `Content-Type: text/csv` and the appropriate `Content-Disposition` filename.

**Modified:**
- `src/lib/actions/attendance.ts` — new exported `getExportRows(eventIds: string[])`: fetches the given events with their records and categories (same Prisma shape `getEventSummary` already uses), flattens into the 9-column row shape described above, across all given events, ordered by `serviceDate` then category `sortOrder`.
- `src/lib/actions/events.ts` — new exported `listEventsInRange(start: string, end: string)`: a `serviceDate` string-range query (`gte`/`lte`), safe as a plain string comparison because `serviceDate` is always stored as a fixed-width `YYYY-MM-DD` string (lexicographic order equals chronological order — no date parsing needed). Validates `start`/`end` with the existing `serviceDateSchema` from `validation.ts` rather than inventing new validation, and rejects `start > end`.

**UI:**
- `src/app/report/[eventId]/page.tsx` — a "Download CSV" link next to the existing `PrintButton`, rendered only when the requesting user (already available via the page's existing `requireUser()` call) has `role === 'ADMIN'`. Links to `/api/export?eventId=<id>`.
- `src/app/settings/page.tsx` — a new "Export Attendance Data" card: a plain GET `<form action="/api/export" method="get">` with `start`/`end` date inputs and a submit button. No Server Action needed — a native form GET already produces the right query string and triggers the browser's download.

## Error handling

- Non-admin request (either UI-hidden or a direct URL hit) → `AuthzError('FORBIDDEN')`, same as every other admin-only path.
- Neither `eventId` nor a `start`/`end` pair present, or both present → 400, short plain-text body.
- `start > end` → 400, checked before querying.
- Unknown `eventId` → 404-equivalent (short plain-text body, 404 status), not a crash.
- Valid range, zero matching events → 200, header-only CSV (see above).

## Testing

- `tests/csv.test.ts` — `toCsv`: header row matches the supplied `columns` list exactly, comma/quote/newline escaping, empty `rows` array with a non-empty `columns` list produces correct header-only output (the specific case the explicit-columns design exists to support).
- `tests/actions-attendance.test.ts` (extended) — `getExportRows`: correct 9-field row shape, `Archived` reflects `event.isArchived`, `Category Type` is the raw enum, multiple events flatten into one array in service-date order.
- `tests/actions-events.test.ts` (extended) — `listEventsInRange`: inclusive boundaries, empty range returns `[]`, malformed date strings rejected via the existing `serviceDateSchema` before any DB query.
- `tests/api-export.test.ts` (new) — route handler tests, importing the `GET` export directly and invoking it with a constructed `Request` (no live server needed): non-admin rejection, `start > end` rejection, neither/both params present rejection, correct `Content-Type`/`Content-Disposition` headers, empty-result-set still 200 with header-only CSV.

## Non-goals / out of scope

- Full CRUD for attendance records — separate spec, to follow this one.
- Any export format other than CSV (no XLSX, no PDF beyond the existing print stylesheet).
- Any change to the on-screen `/report` page's existing `recordedBy` masking rule for non-admin viewers — that page's behavior is unchanged; only the new export endpoint uses the simpler always-include rule, and only because it's admin-only end to end.
- A cap on the date range's size — given this app's actual usage pattern (roughly one service per week for one church), no artificial limit is imposed. If usage patterns change significantly, revisit.
