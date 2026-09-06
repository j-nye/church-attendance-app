# CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Shipped — all tasks implemented (see git history a91aa8e..55c889f); checkboxes below were never ticked during execution.

**Goal:** Let an admin download attendance data as CSV — one service at a time from the report page, or a date range from Settings.

**Architecture:** A pure CSV-formatting helper, two new data-fetching functions (one for multi-event category rows, one for date-range event lookup) added to the existing Server Action files they belong with, and a single GET Route Handler that ties them together and streams the file with proper download headers. Every layer re-checks `requireAdmin()` independently, matching this codebase's established defense-in-depth convention.

**Tech Stack:** Next.js 16 App Router Route Handler (Web-standard `Request`/`Response`, not `NextRequest`/`NextResponse` — avoids the `next/server` Vitest resolution quirk noted in `vitest.config.ts`), Prisma, Zod, Vitest.

## Global Constraints

- Every Server Action re-checks `requireUser()`/`requireAdmin()` independently — never rely on a page-level or route-level check as the sole boundary (existing project convention).
- Categories/events are never hard-deleted — not touched by this plan, but do not introduce any new delete path either.
- No new npm dependency for CSV formatting — hand-rolled, matching this project's convention of not reaching for a library for something small (e.g. the redesign's hand-rolled contrast-ratio script).
- CSV columns, in order: `Service Date, Service Name, Archived, Category Type, Group, Category, Count, Counts Toward Total, Recorded By`. `Recorded By` is always present (the whole endpoint is admin-only, so no per-row masking is needed, unlike the `/report` page's `getEventSummary`).
- Spec reference: `docs/superpowers/specs/2026-08-17-csv-export-design.md`.

---

### Task 1: CSV formatting utility

**Files:**
- Create: `src/lib/csv.ts`
- Test: `tests/csv.test.ts`

**Interfaces:**
- Produces: `toCsv(columns: string[], rows: Record<string, string>[]): string`. `columns` is an explicit, caller-supplied ordered list — never inferred from `rows[0]`'s keys, so a zero-row call still produces a correct header-only CSV.

- [ ] **Step 1: Write the failing tests**

Create `tests/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toCsv } from '@/lib/csv'

describe('toCsv', () => {
  it('emits just the header row for an empty rows array', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B\r\n')
  })

  it('emits a header row and one data row per entry, in column order', () => {
    const result = toCsv(['A', 'B'], [{ A: '1', B: '2' }, { A: '3', B: '4' }])
    expect(result).toBe('A,B\r\n1,2\r\n3,4\r\n')
  })

  it('quotes a field containing a comma', () => {
    expect(toCsv(['Name'], [{ Name: 'Smith, John' }])).toBe('Name\r\n"Smith, John"\r\n')
  })

  it('quotes a field containing a double quote, and doubles the internal quote', () => {
    expect(toCsv(['Note'], [{ Note: 'Say "hi"' }])).toBe('Note\r\n"Say ""hi"""\r\n')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsv(['Note'], [{ Note: 'line one\nline two' }])).toBe('Note\r\n"line one\nline two"\r\n')
  })

  it('does not quote a plain field with no special characters', () => {
    expect(toCsv(['Name'], [{ Name: 'Left Wing' }])).toBe('Name\r\nLeft Wing\r\n')
  })

  it('outputs an empty string for a missing key rather than throwing', () => {
    expect(toCsv(['A', 'B'], [{ A: '1' }])).toBe('A,B\r\n1,\r\n')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- csv
```

Expected: FAIL — `Cannot find module '@/lib/csv'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `toCsv`**

Create `src/lib/csv.ts`:

```ts
/**
 * RFC4180 CSV formatting. `columns` is explicit and caller-supplied rather
 * than inferred from the first row, so a zero-row export still produces a
 * correct header-only file — there's no "first row" to infer from otherwise.
 */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const lines = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]
  return lines.map((fields) => fields.map(escapeField).join(',')).join('\r\n') + '\r\n'
}

function escapeField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- csv
```

Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.ts tests/csv.test.ts
git commit -m "feat: add RFC4180 CSV formatting helper"
```

---

### Task 2: Shared category labels and `getExportRows`

**Files:**
- Create: `src/lib/category-labels.ts`
- Modify: `src/app/report/[eventId]/page.tsx` (import the shared labels instead of declaring its own copy)
- Modify: `src/lib/actions/attendance.ts`
- Test: `tests/actions-attendance.test.ts` (extend)

**Interfaces:**
- Consumes: `Category.type`, `Category.countsTowardTotal`, `Event.isArchived` (all exist as of the redesign plan). `requireAdmin()` from `src/lib/authz.ts`.
- Produces: `TYPE_LABELS: Record<string, string>` (exported from `src/lib/category-labels.ts`). `ExportRow` type and `getExportRows(eventIds: string[]): Promise<ExportRow[]>` (exported from `src/lib/actions/attendance.ts`) — Task 4's route handler calls this directly.

- [ ] **Step 1: Extract the shared label map**

The report page currently declares its own local `TYPE_LABELS` — the export needs the identical mapping for the CSV's `Group` column, so this task makes it one shared source of truth instead of two copies that could drift.

Create `src/lib/category-labels.ts`:

```ts
export const TYPE_LABELS: Record<string, string> = {
  SECTION: 'Sanctuary',
  CLASSROOM: 'Classrooms',
  GROWTH_TRACK: 'Growth Track',
  SERVE_TEAM: 'Serve Teams',
  SERVICE_METRIC: 'Ministry Metrics',
}
```

In `src/app/report/[eventId]/page.tsx`, remove the local declaration:

```ts
const TYPE_LABELS: Record<string, string> = {
  SECTION: 'Sanctuary',
  CLASSROOM: 'Classrooms',
  GROWTH_TRACK: 'Growth Track',
  SERVE_TEAM: 'Serve Teams',
  SERVICE_METRIC: 'Ministry Metrics',
}
```

and add an import at the top instead:

```ts
import { TYPE_LABELS } from '@/lib/category-labels'
```

- [ ] **Step 2: Write the failing test**

Add to `tests/actions-attendance.test.ts`. This file already mocks `@/lib/authz` (`requireUser`, `AuthzError`) and `@/lib/prisma` (`prisma.event`, `prisma.category`, `prisma.attendanceRecord`) — extend both mocks:

Add `requireAdmin` to the existing `vi.mock('@/lib/authz', ...)` block:

```ts
vi.mock('@/lib/authz', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  AuthzError,
}))
```

(add a `const requireAdmin = vi.fn()` near the top alongside the existing `const requireUser = vi.fn()`, and reset it in `beforeEach` alongside the others)

Add `findMany` to the existing `prisma.event` mock:

```ts
vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: {
      findUnique: (...args: unknown[]) => eventFindUnique(...args),
      findMany: (...args: unknown[]) => eventFindMany(...args),
    },
    category: {
      findUnique: (...args: unknown[]) => categoryFindUnique(...args),
    },
    attendanceRecord: {
      upsert: (...args: unknown[]) => attendanceUpsert(...args),
      findMany: (...args: unknown[]) => attendanceFindMany(...args),
    },
  },
}))
```

(add `const eventFindMany = vi.fn()` near the top, reset it in `beforeEach`)

Update the import line to include the new export:

```ts
const { saveCount, getEventCounts, getEventSummary, getExportRows } = await import('@/lib/actions/attendance')
```

Add a new `describe` block:

```ts
describe('getExportRows', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(getExportRows(['e1'])).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty array without querying when given no event ids', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const result = await getExportRows([])
    expect(result).toEqual([])
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('flattens multiple events into one row array with the full 9-field shape', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([
      {
        id: 'e1',
        name: 'Sunday Service',
        serviceDate: '2026-08-09',
        isArchived: false,
        records: [
          {
            count: 10,
            recordedBy: 'vol@example.com',
            category: { type: 'SECTION', name: 'Left Wing', countsTowardTotal: true },
          },
        ],
      },
      {
        id: 'e2',
        name: 'Sunday Service',
        serviceDate: '2026-08-16',
        isArchived: true,
        records: [
          {
            count: 2,
            recordedBy: 'vol2@example.com',
            category: { type: 'SERVICE_METRIC', name: 'Salvations', countsTowardTotal: false },
          },
        ],
      },
    ])

    const result = await getExportRows(['e1', 'e2'])

    expect(result).toEqual([
      {
        serviceDate: '2026-08-09',
        serviceName: 'Sunday Service',
        archived: false,
        categoryType: 'SECTION',
        group: 'Sanctuary',
        categoryName: 'Left Wing',
        count: 10,
        countsTowardTotal: true,
        recordedBy: 'vol@example.com',
      },
      {
        serviceDate: '2026-08-16',
        serviceName: 'Sunday Service',
        archived: true,
        categoryType: 'SERVICE_METRIC',
        group: 'Ministry Metrics',
        categoryName: 'Salvations',
        count: 2,
        countsTowardTotal: false,
        recordedBy: 'vol2@example.com',
      },
    ])
    expect(eventFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] } },
      include: {
        records: {
          include: { category: true },
          orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }],
        },
      },
      orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
    })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- actions-attendance
```

Expected: FAIL — `getExportRows` is not exported from `@/lib/actions/attendance`.

- [ ] **Step 4: Implement `getExportRows`**

Add to `src/lib/actions/attendance.ts`. First add the import at the top:

```ts
import { requireUser, requireAdmin } from '@/lib/authz'
import { TYPE_LABELS } from '@/lib/category-labels'
```

(this replaces the existing `import { requireUser } from '@/lib/authz'` line — add `requireAdmin` to it)

Then add at the end of the file:

```ts
export type ExportRow = {
  serviceDate: string
  serviceName: string
  archived: boolean
  categoryType: string
  group: string
  categoryName: string
  count: number
  countsTowardTotal: boolean
  recordedBy: string
}

/**
 * Flattened (event, category) rows for CSV export, across any number of
 * events. Always includes recordedBy unconditionally — unlike
 * getEventSummary's per-row masking, this whole endpoint is admin-only end
 * to end, so there's no volunteer-facing view of this data to protect.
 */
export async function getExportRows(eventIds: string[]): Promise<ExportRow[]> {
  await requireAdmin()
  if (eventIds.length === 0) return []

  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    include: {
      records: {
        include: { category: true },
        orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }],
      },
    },
    orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
  })

  return events.flatMap((event) =>
    event.records.map((record) => ({
      serviceDate: event.serviceDate,
      serviceName: event.name,
      archived: event.isArchived,
      categoryType: record.category.type,
      group: TYPE_LABELS[record.category.type] ?? record.category.type,
      categoryName: record.category.name,
      count: record.count,
      countsTowardTotal: record.category.countsTowardTotal,
      recordedBy: record.recordedBy,
    }))
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -- actions-attendance
```

Expected: PASS, all tests in the file including the 3 new ones.

- [ ] **Step 6: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean — confirms the report page's import swap didn't break anything.

- [ ] **Step 7: Commit**

```bash
git add src/lib/category-labels.ts "src/app/report/[eventId]/page.tsx" src/lib/actions/attendance.ts tests/actions-attendance.test.ts
git commit -m "feat: add getExportRows and extract shared category type labels"
```

---

### Task 3: `listEventsInRange`

**Files:**
- Modify: `src/lib/validation.ts` (export the existing `serviceDateSchema`)
- Modify: `src/lib/actions/events.ts`
- Test: `tests/actions-events.test.ts` (extend)
- Test: `tests/validation.test.ts` (extend)

**Interfaces:**
- Consumes: `requireAdmin()` from `src/lib/authz.ts`.
- Produces: `serviceDateSchema` (now exported from `src/lib/validation.ts` — was previously module-private). `listEventsInRange(start: string, end: string): Promise<Event[]>` (exported from `src/lib/actions/events.ts`) — Task 4's route handler calls this directly. Throws a plain `Error` (not a Zod error) for a reversed range (`start > end`).

- [ ] **Step 1: Write the failing test for the schema export**

Add to `tests/validation.test.ts` (add `serviceDateSchema` to the existing import line from `@/lib/validation`):

```ts
describe('serviceDateSchema', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(serviceDateSchema.parse('2026-08-16')).toBe('2026-08-16')
  })

  it('rejects a non-calendar date', () => {
    expect(() => serviceDateSchema.parse('2026-02-30')).toThrow()
  })

  it('rejects a timestamp', () => {
    expect(() => serviceDateSchema.parse('2026-08-16T00:00:00Z')).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- validation
```

Expected: FAIL — `serviceDateSchema` is not exported yet (it's currently a module-private `const` in `src/lib/validation.ts`), so the import in the test file resolves to `undefined` and `.parse` throws a `TypeError`.

- [ ] **Step 3: Export `serviceDateSchema`**

In `src/lib/validation.ts`, change:

```ts
const serviceDateSchema = z
```

to:

```ts
export const serviceDateSchema = z
```

(no other change to that declaration — same regex, same `.refine()`)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- validation
```

Expected: PASS, all 3 new tests plus the existing suite.

- [ ] **Step 5: Write the failing test for `listEventsInRange`**

Add to `tests/actions-events.test.ts`. Add `eventFindMany` reuse (this file already has `const eventFindMany = vi.fn()` from `listEvents`'s tests — reuse it, no new mock const needed) and update the import line:

```ts
const { listEvents, createEvent, archiveEvent, getOrCreateTodayEvent, listEventsInRange } = await import(
  '@/lib/actions/events'
)
```

Add a new `describe` block:

```ts
describe('listEventsInRange', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(listEventsInRange('2026-08-01', '2026-08-31')).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('rejects a malformed start date before querying', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(listEventsInRange('not-a-date', '2026-08-31')).rejects.toThrow()
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('rejects a reversed range before querying', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(listEventsInRange('2026-08-31', '2026-08-01')).rejects.toThrow(
      'start must not be after end'
    )
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('queries events with serviceDate between start and end, inclusive, ordered by date then name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([{ id: 'e1' }])
    const result = await listEventsInRange('2026-08-01', '2026-08-31')
    expect(result).toEqual([{ id: 'e1' }])
    expect(eventFindMany).toHaveBeenCalledWith({
      where: { serviceDate: { gte: '2026-08-01', lte: '2026-08-31' } },
      orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
    })
  })

  it('returns an empty array for a range that matches no events', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([])
    const result = await listEventsInRange('2020-01-01', '2020-01-31')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
npm test -- actions-events
```

Expected: FAIL — `listEventsInRange` is not exported from `@/lib/actions/events`.

- [ ] **Step 7: Implement `listEventsInRange`**

In `src/lib/actions/events.ts`, update the import line:

```ts
import { createEventSchema, serviceDateSchema, idSchema } from '@/lib/validation'
```

Add at the end of the file:

```ts
/**
 * Events whose serviceDate falls within [start, end], inclusive. Includes
 * archived events — an export is a historical record, and archiving isn't
 * deletion.
 */
export async function listEventsInRange(start: string, end: string) {
  await requireAdmin()
  const startDate = serviceDateSchema.parse(start)
  const endDate = serviceDateSchema.parse(end)
  if (startDate > endDate) throw new Error('start must not be after end')

  return prisma.event.findMany({
    where: { serviceDate: { gte: startDate, lte: endDate } },
    orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
  })
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
npm test -- actions-events
```

Expected: PASS, all tests in the file including the 5 new ones.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validation.ts src/lib/actions/events.ts tests/actions-events.test.ts tests/validation.test.ts
git commit -m "feat: add listEventsInRange and export serviceDateSchema"
```

---

### Task 4: Export Route Handler

**Files:**
- Create: `src/app/api/export/route.ts`
- Test: `tests/api-export.test.ts`

**Interfaces:**
- Consumes: `getExportRows` (Task 2), `listEventsInRange` (Task 3), `toCsv` (Task 1), `requireAdmin`/`AuthzError` (`src/lib/authz.ts`), `prisma.event.findUnique` (existence check for single-event mode).
- Produces: `GET(request: Request): Promise<Response>`, exported for Next.js's routing AND for direct import in tests.

- [ ] **Step 1: Write the failing tests**

Create `tests/api-export.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const eventFindUnique = vi.fn()
const getExportRows = vi.fn()
const listEventsInRange = vi.fn()

class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code)
  }
}

vi.mock('@/lib/authz', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  AuthzError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: {
      findUnique: (...args: unknown[]) => eventFindUnique(...args),
    },
  },
}))

vi.mock('@/lib/actions/attendance', () => ({
  getExportRows: (...args: unknown[]) => getExportRows(...args),
}))

vi.mock('@/lib/actions/events', () => ({
  listEventsInRange: (...args: unknown[]) => listEventsInRange(...args),
}))

const { GET } = await import('@/app/api/export/route')

beforeEach(() => {
  requireAdmin.mockReset()
  eventFindUnique.mockReset()
  getExportRows.mockReset()
  listEventsInRange.mockReset()
})

function request(query: string) {
  return new Request(`http://localhost/api/export${query}`)
}

describe('GET /api/export', () => {
  it('rejects a non-admin with 403', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    const response = await GET(request('?eventId=e1'))
    expect(response.status).toBe(403)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a request with neither eventId nor a date range with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request(''))
    expect(response.status).toBe(400)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a request with both eventId and a date range with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?eventId=e1&start=2026-08-01&end=2026-08-31'))
    expect(response.status).toBe(400)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a range request missing end with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?start=2026-08-01'))
    expect(response.status).toBe(400)
    expect(listEventsInRange).not.toHaveBeenCalled()
  })

  it('rejects start after end with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?start=2026-08-31&end=2026-08-01'))
    expect(response.status).toBe(400)
    expect(listEventsInRange).not.toHaveBeenCalled()
  })

  it('returns 404 for an eventId that does not exist', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue(null)
    const response = await GET(request('?eventId=missing'))
    expect(response.status).toBe(404)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('returns a CSV with the right headers for a valid single-event export', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'e1', serviceDate: '2026-08-16' })
    getExportRows.mockResolvedValue([
      {
        serviceDate: '2026-08-16',
        serviceName: 'Sunday Service',
        archived: false,
        categoryType: 'SECTION',
        group: 'Sanctuary',
        categoryName: 'Left Wing',
        count: 5,
        countsTowardTotal: true,
        recordedBy: 'vol@example.com',
      },
    ])

    const response = await GET(request('?eventId=e1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="attendance-2026-08-16.csv"'
    )
    const body = await response.text()
    expect(body).toContain('Service Date,Service Name,Archived,Category Type,Group,Category,Count,Counts Toward Total,Recorded By')
    expect(body).toContain('2026-08-16,Sunday Service,false,SECTION,Sanctuary,Left Wing,5,true,vol@example.com')
    expect(getExportRows).toHaveBeenCalledWith(['e1'])
  })

  it('returns a 200 header-only CSV for a valid range matching zero events', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    listEventsInRange.mockResolvedValue([])
    getExportRows.mockResolvedValue([])

    const response = await GET(request('?start=2020-01-01&end=2020-01-31'))

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe(
      'Service Date,Service Name,Archived,Category Type,Group,Category,Count,Counts Toward Total,Recorded By\r\n'
    )
  })

  it('builds the range filename from start and end, and passes every matched event id to getExportRows', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    listEventsInRange.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    getExportRows.mockResolvedValue([])

    const response = await GET(request('?start=2026-08-01&end=2026-08-31'))

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="attendance-2026-08-01-to-2026-08-31.csv"'
    )
    expect(getExportRows).toHaveBeenCalledWith(['e1', 'e2'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- api-export
```

Expected: FAIL — `Cannot find module '@/app/api/export/route'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the route handler**

Create `src/app/api/export/route.ts`:

```ts
import { prisma } from '@/lib/prisma'
import { requireAdmin, AuthzError } from '@/lib/authz'
import { getExportRows, type ExportRow } from '@/lib/actions/attendance'
import { listEventsInRange } from '@/lib/actions/events'
import { toCsv } from '@/lib/csv'

const COLUMNS = [
  'Service Date',
  'Service Name',
  'Archived',
  'Category Type',
  'Group',
  'Category',
  'Count',
  'Counts Toward Total',
  'Recorded By',
]

function toCsvRow(row: ExportRow): Record<string, string> {
  return {
    'Service Date': row.serviceDate,
    'Service Name': row.serviceName,
    Archived: String(row.archived),
    'Category Type': row.categoryType,
    Group: row.group,
    Category: row.categoryName,
    Count: String(row.count),
    'Counts Toward Total': String(row.countsTowardTotal),
    'Recorded By': row.recordedBy,
  }
}

function csvResponse(rows: ExportRow[], filename: string): Response {
  const csv = toCsv(COLUMNS, rows.map(toCsvRow))
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(error.code === 'UNAUTHENTICATED' ? 'Not signed in' : 'Not authorized', {
        status: 403,
      })
    }
    throw error
  }

  const url = new URL(request.url)
  const eventId = url.searchParams.get('eventId')
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')

  const hasEventId = Boolean(eventId)
  const hasRange = Boolean(start) || Boolean(end)

  if (hasEventId === hasRange) {
    return new Response('Provide either eventId, or both start and end — not neither or both', {
      status: 400,
    })
  }

  if (hasEventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId! },
      select: { id: true, serviceDate: true },
    })
    if (!event) return new Response('No such service', { status: 404 })

    const rows = await getExportRows([event.id])
    return csvResponse(rows, `attendance-${event.serviceDate}.csv`)
  }

  if (!start || !end) {
    return new Response('Both start and end are required for a range export', { status: 400 })
  }
  if (start > end) {
    return new Response('start must not be after end', { status: 400 })
  }

  const events = await listEventsInRange(start, end)
  const rows = await getExportRows(events.map((event) => event.id))
  return csvResponse(rows, `attendance-${start}-to-${end}.csv`)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- api-export
```

Expected: PASS, 9/9.

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/export/route.ts tests/api-export.test.ts
git commit -m "feat: add GET /api/export route handler for CSV downloads"
```

---

### Task 5: UI — download links on the report and settings pages

**Files:**
- Modify: `src/app/report/[eventId]/page.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: nothing new — this task is pure UI, linking to the already-built `/api/export` route from Task 4.

- [ ] **Step 1: Add the single-service download link to the report page**

In `src/app/report/[eventId]/page.tsx`, `getEventSummary` doesn't currently return the calling user's role, so the page can't yet tell if the viewer is an admin. Change the destructured return to also pull `rows`/`totals`/`event` as before, and additionally fetch the user role via a lightweight approach: `getEventSummary` already calls `requireUser()` internally, but doesn't expose the result to its caller. Rather than changing `getEventSummary`'s return shape (which Task 3/4 of the redesign plan and this plan's Task 2 both already depend on staying stable), call `requireUser` directly in the page component — it's cheap (the allowlist row is already being read by `getEventSummary` moments later, so this is one extra fast query, not a new round-trip to an external service):

Add the import:

```ts
import { requireUser } from '@/lib/authz'
```

Change the component body from:

```tsx
export default async function ReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const { event, rows, totals } = await getEventSummary(eventId)
```

to:

```tsx
export default async function ReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const [user, { event, rows, totals }] = await Promise.all([requireUser(), getEventSummary(eventId)])
```

Change the header's button row from:

```tsx
        <PrintButton />
```

to:

```tsx
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {user.role === 'ADMIN' && (
            <a
              href={`/api/export?eventId=${eventId}`}
              className="no-print"
              style={{
                display: 'inline-flex', alignItems: 'center', padding: '0 var(--space-4)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                color: 'var(--color-text)', textDecoration: 'none',
              }}
            >
              Download CSV
            </a>
          )}
          <PrintButton />
        </div>
```

(the `no-print` class matches the existing convention — `PrintButton` already uses it — so the download link doesn't show up in the printed/PDF version of the report)

- [ ] **Step 2: Add the date-range export form to Settings**

In `src/app/settings/page.tsx`, add a new `<section>` — place it after the existing "Who can sign in" section, at the end of the `<main>`:

```tsx
      <section className="card" style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0 }}>Export attendance data</h2>
        <form action="/api/export" method="get" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            Start date
            <input type="date" name="start" required style={{ padding: 'var(--space-3)' }} />
          </label>
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            End date
            <input type="date" name="end" required style={{ padding: 'var(--space-3)' }} />
          </label>
          <button type="submit">Download CSV</button>
        </form>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Downloads one row per category per service for every service in the range, including
          archived services.
        </p>
      </section>
```

This is a plain GET form — no Server Action, no `'use server'` — the browser's native form submission builds `?start=...&end=...` and the browser's own download handling takes over from the `Content-Disposition` header Task 4's route already sets.

- [ ] **Step 3: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all passing — this task doesn't add new tests (it's UI wiring around an already-tested route), but must not break anything that exists.

- [ ] **Step 5: Manually verify in the browser**

Start the dev server, sign in as admin:
1. Open `/report/<eventId>` for a service with some recorded counts. Confirm a "Download CSV" button appears next to "Print summary", and clicking it downloads a `attendance-<date>.csv` file with the right columns and data.
2. Open `/settings`, scroll to "Export attendance data", pick a start/end date spanning at least one real service, submit, and confirm a `attendance-<start>-to-<end>.csv` file downloads with the expected rows.
3. Sign in as a VOLUNTEER-role account (or reason through the code if a second test account isn't available) and confirm the "Download CSV" button does NOT appear on the report page, and that hitting `/api/export?eventId=<id>` directly returns a 403, not a file.

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[eventId]/page.tsx" src/app/settings/page.tsx
git commit -m "feat: add CSV download links to the report and settings pages"
```
