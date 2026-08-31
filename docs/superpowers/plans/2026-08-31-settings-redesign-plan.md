# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for implementation.

**Goal:** Redesign Settings around two admin tasks that are currently impossible or awkward: a category manager grouped by type (contextual per-section add, up/down reorder, inline rename, edit-with-warning for type/countsTowardTotal/svgKey, hide/show, delete-if-unused), and a Services section (create/archive/unarchive events) that finally gives the roadmap's Phase 3 event-lifecycle actions a UI home.

**Architecture:** Six new/changed Server Actions in the existing `src/lib/actions/categories.ts` (`createCategory`'s sortOrder fix, `moveCategory`, `renameCategory` + its `useActionState` wrapper, `reactivateCategory`, `updateCategory`, `deleteCategory`) and four in `src/lib/actions/events.ts` (`createEvent`/`archiveEvent` revalidation extensions, `createEventAction`, `unarchiveEvent`, `listRecentEvents`), backed by a one-time `sortOrder` normalization in `prisma/seed.ts` and a new `nextSundayServiceDate` helper in `src/lib/dates.ts`. `settings/page.tsx` decomposes into two new Client Components — `CategorySection` (rendered once per `CategoryType`, in `TYPE_LABELS` order, internally composing a rewritten `AddCategoryForm`) and `ServicesSection` — plus a shared `ConfirmDialog` (the required-checkbox warning used for Delete category and Archive service) and a bespoke `EditCategoryDialog` (the type/countsTowardTotal/svgKey form, gated by the same warning pattern). The allowlist and export sections are untouched.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma 6.19 (interactive `$transaction` for `moveCategory`'s swap), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-settings-redesign-design.md`.

## Global Constraints

- Every category/service mutation calls `requireAdmin()` as its first statement — the existing project convention; every action below does this independently of the page-level `requireAdminPage()` gate.
- `createCategory` and `reactivateCategory` both set `sortOrder = (max sortOrder of active same-type categories) + 1`, computed server-side — never trust a client-supplied sortOrder for either.
- `moveCategory({ id, direction })` swaps `sortOrder` with the adjacent **active** same-type category, both writes inside one `prisma.$transaction`. No neighbor (a boundary row) is a graceful no-op — it returns normally, never throws.
- `updateCategory` clears `svgKey` server-side whenever the new `type !== 'SECTION'`, regardless of what the client sent.
- `deleteCategory` requires admin, re-checks `attendanceRecord.count({ where: { categoryId } }) === 0` server-side — it never trusts a UI-computed `hasRecords` flag; that flag only controls whether the Delete button renders — and only then hard-deletes. Otherwise it throws a friendly rejection. The DB's `onDelete: Restrict` on `AttendanceRecord.category` is the backstop.
- The Edit and Delete warnings are dialogs with a required confirmation checkbox that gates the destructive button — never `window.confirm()`.
- `unarchiveEvent` is symmetric with the existing `archiveEvent` and carries no warning dialog, matching the Hide/Show asymmetry — only the action that stops something needs a warning.
- Every category action revalidates `'/settings'`. Anything that changes what an active category looks like, its order, or its visibility also revalidates the whole entry-page family with `revalidatePath('/entry/[eventId]', 'page')` — a route-pattern revalidation, since categories are shared across every event's entry screen, not scoped to one `eventId`. Event lifecycle actions (`createEvent`, `archiveEvent`, `unarchiveEvent`) instead revalidate the one concrete `/entry/<id>` path they affect, plus `'/dashboard'` and `'/settings'`.
- A section's Add form sends its fixed `type` to `createCategoryAction` via a hidden `<input type="hidden" name="type">`, not a dropdown — `createCategoryAction`'s `formData.get('type')` parsing is completely unchanged by this plan.
- The one-time `sortOrder` normalization (fixing pre-existing ties at `0`) lives in `normalizeCategorySortOrder()`, called from `seedCategories()` in `prisma/seed.ts` — idempotent, so re-running `npm run db:seed` in production once as part of shipping this feature is safe.
- `recordedBy`/`createdAt`/role checks stay server-derived, never from input, matching every other mutation in this codebase.

---

### Task 1: Validation schemas and the `nextSundayServiceDate` helper

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/dates.ts`
- Test: `tests/validation.test.ts` (extend)
- Test: `tests/dates.test.ts` (extend)

**Interfaces:**
- Produces: `moveCategorySchema`, `renameCategorySchema`, a redefined `updateCategorySchema` (from `src/lib/validation.ts`); `nextSundayServiceDate(from?: Date): string` (from `src/lib/dates.ts`). Consumed by Tasks 3–8.
- Note: `src/lib/validation.ts` already exports an `updateCategorySchema` of shape `{ id, name, sortOrder }`, left over from the `renameCategory`/`reactivateCategory` actions removed in `d22dd23`. Nothing in the codebase imports it today (confirmed by grep). This task repurposes the name for the new `updateCategory` action's actual shape (`{ id, type, countsTowardTotal, svgKey }`) rather than carrying two competing conventions — there is no caller to migrate.

- [x] **Step 1: Write the failing validation tests**

In `tests/validation.test.ts`, update the import block at the top from:

```ts
import {
  saveCountSchema,
  deleteCountSchema,
  addSpeakerSchema,
  removeSpeakerSchema,
  categoryTypeSchema,
  createCategorySchema,
  createEventSchema,
  allowlistEntrySchema,
  friendlyValidationMessage,
  CATEGORY_NAME_MAX,
  serviceDateSchema,
} from '@/lib/validation'
```

to:

```ts
import {
  saveCountSchema,
  deleteCountSchema,
  addSpeakerSchema,
  removeSpeakerSchema,
  categoryTypeSchema,
  createCategorySchema,
  createEventSchema,
  allowlistEntrySchema,
  friendlyValidationMessage,
  CATEGORY_NAME_MAX,
  serviceDateSchema,
  moveCategorySchema,
  renameCategorySchema,
  updateCategorySchema,
} from '@/lib/validation'
```

Add these new `describe` blocks (placed after the existing `createEventSchema` block is a reasonable spot, but placement doesn't matter to the test runner):

```ts
describe('moveCategorySchema', () => {
  it('accepts a valid id and direction', () => {
    expect(moveCategorySchema.parse({ id: 'id1', direction: 'up' })).toEqual({
      id: 'id1',
      direction: 'up',
    })
  })

  it('accepts "down" as a direction', () => {
    expect(moveCategorySchema.parse({ id: 'id1', direction: 'down' }).direction).toBe('down')
  })

  it('rejects a direction that is not up or down', () => {
    expect(() => moveCategorySchema.parse({ id: 'id1', direction: 'sideways' })).toThrow()
  })

  it('rejects an empty id', () => {
    expect(() => moveCategorySchema.parse({ id: '', direction: 'up' })).toThrow()
  })
})

describe('renameCategorySchema', () => {
  it('accepts a valid id and name', () => {
    expect(renameCategorySchema.parse({ id: 'id1', name: 'New Name' })).toEqual({
      id: 'id1',
      name: 'New Name',
    })
  })

  it('rejects an empty name', () => {
    expect(() => renameCategorySchema.parse({ id: 'id1', name: '' })).toThrow()
  })

  it('rejects a name longer than CATEGORY_NAME_MAX characters', () => {
    expect(() =>
      renameCategorySchema.parse({ id: 'id1', name: 'x'.repeat(CATEGORY_NAME_MAX + 1) })
    ).toThrow()
  })

  it('trims whitespace from the name', () => {
    expect(renameCategorySchema.parse({ id: 'id1', name: '  Nursery  ' }).name).toBe('Nursery')
  })
})

describe('updateCategorySchema', () => {
  const valid = { id: 'id1', type: 'SECTION' as const, countsTowardTotal: true, svgKey: 'left-wing' }

  it('accepts a valid update with a svgKey', () => {
    expect(updateCategorySchema.parse(valid)).toEqual(valid)
  })

  it('accepts a null svgKey', () => {
    expect(updateCategorySchema.parse({ ...valid, svgKey: null })).toEqual({ ...valid, svgKey: null })
  })

  it('rejects an invalid type', () => {
    expect(() => updateCategorySchema.parse({ ...valid, type: 'BOGUS' })).toThrow()
  })

  it('rejects a missing countsTowardTotal', () => {
    const { countsTowardTotal: _omit, ...rest } = valid
    expect(() => updateCategorySchema.parse(rest)).toThrow()
  })

  it('rejects an empty id', () => {
    expect(() => updateCategorySchema.parse({ ...valid, id: '' })).toThrow()
  })
})

describe('friendlyValidationMessage — service date field label', () => {
  it('reports a bad service date using the "Service date" label, not the raw field name', () => {
    const { error } = createEventSchema.safeParse({ name: 'Sunday', serviceDate: 'not-a-date' })
    expect(friendlyValidationMessage(error!)).toBe('Service date is not valid.')
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
npm test -- validation
```

Expected: FAIL — `moveCategorySchema` and `renameCategorySchema` are not exported yet, and `updateCategorySchema` still has the old `{ id, name, sortOrder }` shape so the new-shape tests fail too.

- [x] **Step 3: Add the schemas and the field label**

In `src/lib/validation.ts`, replace the existing `updateCategorySchema` block:

```ts
export const updateCategorySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  sortOrder: z.number().int().min(0).max(999),
})
```

with:

```ts
export const updateCategorySchema = z.object({
  id: idSchema,
  type: categoryTypeSchema,
  countsTowardTotal: z.boolean(),
  svgKey: z.string().trim().max(40).nullable(),
})

export const moveCategorySchema = z.object({
  id: idSchema,
  direction: z.enum(['up', 'down']),
})

export const renameCategorySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
})
```

Add a `serviceDate` entry to `FIELD_LABELS` (change from):

```ts
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Category type',
  email: 'Email address',
  role: 'Role',
}
```

to:

```ts
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Category type',
  email: 'Email address',
  role: 'Role',
  serviceDate: 'Service date',
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
npm test -- validation
```

Expected: PASS, all new tests plus the existing suite.

- [x] **Step 5: Write the failing test for `nextSundayServiceDate`**

In `tests/dates.test.ts`, update the import line from:

```ts
import { toServiceDate, formatServiceDate, CHURCH_TIMEZONE } from '@/lib/dates'
```

to:

```ts
import { toServiceDate, formatServiceDate, nextSundayServiceDate, CHURCH_TIMEZONE } from '@/lib/dates'
```

Add a new `describe` block:

```ts
describe('nextSundayServiceDate', () => {
  it('returns the same date when today is already a Sunday', () => {
    // 2026-08-09T13:00:00Z is 9am Eastern on Sunday 2026-08-09 (per the toServiceDate fixture above).
    expect(nextSundayServiceDate(new Date('2026-08-09T13:00:00Z'))).toBe('2026-08-09')
  })

  it('returns the upcoming Sunday when today is a weekday', () => {
    // 2026-08-31 is a Monday; the next Sunday is 2026-09-06.
    expect(nextSundayServiceDate(new Date('2026-08-31T13:00:00Z'))).toBe('2026-09-06')
  })

  it('returns the upcoming Sunday when today is a Saturday', () => {
    // 2026-08-15 is a Saturday; the next Sunday is 2026-08-16.
    expect(nextSundayServiceDate(new Date('2026-08-15T13:00:00Z'))).toBe('2026-08-16')
  })

  it('rolls over at church-local midnight like toServiceDate does', () => {
    // 2026-08-09T03:30Z is 11:30pm Eastern on Saturday 2026-08-08 — the
    // church-local day hasn't rolled to Sunday yet, so the next Sunday is
    // still tomorrow (2026-08-09), not today.
    expect(nextSundayServiceDate(new Date('2026-08-09T03:30:00Z'))).toBe('2026-08-09')
  })

  it('defaults to now when no instant is passed', () => {
    expect(() => nextSundayServiceDate()).not.toThrow()
    expect(nextSundayServiceDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

- [x] **Step 6: Run the test to verify it fails**

```bash
npm test -- dates
```

Expected: FAIL — `nextSundayServiceDate` is not exported from `@/lib/dates`.

- [x] **Step 7: Implement `nextSundayServiceDate`**

Add to the end of `src/lib/dates.ts`:

```ts
/**
 * The next church-local Sunday on/after `from` — today itself if today is
 * already Sunday. Defaults the "create a service" form's date field.
 *
 * Deliberately does NOT re-run the result through toServiceDate(): that
 * function applies CHURCH_TIMEZONE to an *instant*, and by this point we've
 * already resolved a calendar date and are only doing pure Y/M/D arithmetic
 * on it. Re-converting a UTC-midnight instant built from that date back
 * through CHURCH_TIMEZONE would shift it a day backward (America/New_York
 * is behind UTC) — the same trap formatServiceDate's UTC-anchored math
 * avoids by formatting with `timeZone: 'UTC'` instead of the church zone.
 */
export function nextSundayServiceDate(from: Date = new Date()): string {
  const [year, month, day] = toServiceDate(from).split('-').map(Number)
  const asUTC = new Date(Date.UTC(year, month - 1, day))
  const daysUntilSunday = (7 - asUTC.getUTCDay()) % 7 // 0 if `from`'s date is already Sunday
  asUTC.setUTCDate(asUTC.getUTCDate() + daysUntilSunday)

  const y = asUTC.getUTCFullYear()
  const m = String(asUTC.getUTCMonth() + 1).padStart(2, '0')
  const d = String(asUTC.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

- [x] **Step 8: Run the tests to verify they pass**

```bash
npm test -- dates
```

Expected: PASS, all 5 new tests plus the existing suite.

- [x] **Step 9: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 10: Commit**

```bash
git add src/lib/validation.ts src/lib/dates.ts tests/validation.test.ts tests/dates.test.ts
git commit -m "feat: add moveCategory/renameCategory/updateCategory schemas and nextSundayServiceDate"
```

---

### Task 2: One-time `sortOrder` normalization in `prisma/seed.ts`

**Files:**
- Modify: `prisma/seed.ts`
- Test: `tests/seed.test.ts` (extend — live-database tests, `describe.skipIf(!hasDatabase)`, same pattern as the existing `seedCategories` block)

**Interfaces:**
- Consumes: `prisma.category.findMany`, `prisma.category.update` (both already available on the seed script's own `PrismaClient` instance).
- Produces: `normalizeCategorySortOrder(): Promise<void>` (exported from `prisma/seed.ts`), called from `seedCategories()`. Consumed by Task 3's `moveCategory`, which depends on there being no `sortOrder` ties within an active type before its "swap with the adjacent category" logic is meaningful.

Before `createCategory` gets its `sortOrder = max + 1` fix in Task 3, every category ever added through the Settings "Add a category" form kept the schema default `sortOrder: 0` — so every type's admin-added categories collide at `0`. This task fixes that once, for existing data, independent of the Task 3 code fix (which only prevents *new* collisions going forward).

- [ ] **Step 1: Write the failing tests**

In `tests/seed.test.ts`, update the import line from:

```ts
import { seedCategories, DEFAULT_CATEGORIES } from '../prisma/seed'
```

to:

```ts
import { seedCategories, normalizeCategorySortOrder, DEFAULT_CATEGORIES } from '../prisma/seed'
```

Add a new `describe` block at the end of the file:

```ts
describe.skipIf(!hasDatabase)('normalizeCategorySortOrder (live database)', () => {
  it('renumbers active categories of the same type to 0,1,2… breaking ties by createdAt', async () => {
    // Two categories artificially left at the same colliding sortOrder — the
    // pre-2026-08-31 state every admin-added category was actually in, since
    // createCategory() never set sortOrder before this feature shipped.
    const older = await prisma.category.upsert({
      where: { name_type: { name: 'Zzz Test Older', type: 'SERVE_TEAM' } },
      update: { isActive: true, sortOrder: 0 },
      create: { name: 'Zzz Test Older', type: 'SERVE_TEAM', sortOrder: 0, isActive: true },
    })
    await new Promise((resolve) => setTimeout(resolve, 10)) // guarantee a distinct createdAt
    const newer = await prisma.category.upsert({
      where: { name_type: { name: 'Zzz Test Newer', type: 'SERVE_TEAM' } },
      update: { isActive: true, sortOrder: 0 },
      create: { name: 'Zzz Test Newer', type: 'SERVE_TEAM', sortOrder: 0, isActive: true },
    })

    await normalizeCategorySortOrder()

    const [olderAfter, newerAfter] = await Promise.all([
      prisma.category.findUniqueOrThrow({ where: { id: older.id } }),
      prisma.category.findUniqueOrThrow({ where: { id: newer.id } }),
    ])
    expect(olderAfter.sortOrder).toBeLessThan(newerAfter.sortOrder)

    await prisma.category.deleteMany({ where: { id: { in: [older.id, newer.id] } } })
  })

  it('is idempotent — running it twice in a row makes no further changes the second time', async () => {
    await seedCategories()
    await normalizeCategorySortOrder()

    const before = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, sortOrder: true },
    })

    await normalizeCategorySortOrder()

    const after = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, sortOrder: true },
    })
    expect(after).toEqual(before)
  })

  it('is called by seedCategories(), so npm run db:seed fixes pre-existing ties in one step', async () => {
    await prisma.category.upsert({
      where: { name_type: { name: 'Zzz Test Tie', type: 'GROWTH_TRACK' } },
      update: { isActive: true, sortOrder: 0 },
      create: { name: 'Zzz Test Tie', type: 'GROWTH_TRACK', sortOrder: 0, isActive: true },
    })

    await seedCategories()

    const activeGrowthTrack = await prisma.category.findMany({
      where: { type: 'GROWTH_TRACK', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    })
    const sortOrders = activeGrowthTrack.map((c) => c.sortOrder)
    expect(new Set(sortOrders).size).toBe(sortOrders.length) // no ties remain
    expect(sortOrders).toEqual(sortOrders.map((_, i) => i)) // exactly 0,1,2,… with no gaps

    await prisma.category.deleteMany({ where: { name: 'Zzz Test Tie', type: 'GROWTH_TRACK' } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail (or skip)**

```bash
npm test -- seed
```

Expected: FAIL with "normalizeCategorySortOrder is not a function" if `DATABASE_URL` is reachable in this environment, or SKIP (matching the existing `seedCategories` block's behavior) if it isn't. Either outcome is fine at this step — the point is confirming the import doesn't silently resolve to something that already passes.

- [ ] **Step 3: Implement `normalizeCategorySortOrder`**

Add to `prisma/seed.ts`, after `seedCategories`:

```ts
/**
 * One-time fix for the pre-2026-08-31 sortOrder scheme: every category
 * created through the Settings "Add a category" form got the schema
 * default sortOrder: 0, so every type's admin-added categories collided at
 * 0 — harmless while sortOrder was purely cosmetic, but ambiguous now that
 * moveCategory() swaps sortOrder with "the adjacent active category of the
 * same type." This renumbers every ACTIVE category, grouped by type, to
 * 0,1,2… in its current sortOrder order (ties broken by createdAt, then id,
 * so the renumbering is deterministic and idempotent — running it twice in
 * a row produces the same result the second time).
 *
 * Called from seedCategories() so `npm run db:seed` fixes existing ties in
 * one step; safe to run repeatedly.
 */
export async function normalizeCategorySortOrder() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })

  const byType = new Map<string, typeof categories>()
  for (const category of categories) {
    const list = byType.get(category.type) ?? []
    list.push(category)
    byType.set(category.type, list)
  }

  for (const list of byType.values()) {
    for (const [index, category] of list.entries()) {
      if (category.sortOrder !== index) {
        await prisma.category.update({ where: { id: category.id }, data: { sortOrder: index } })
      }
    }
  }
}
```

Then call it at the end of `seedCategories()` — change:

```ts
  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: {
        isActive: true,
        sortOrder: index,
        svgKey: category.svgKey,
        countsTowardTotal: category.countsTowardTotal ?? true,
      },
      create: { ...category, sortOrder: index },
    })
  }
}
```

to:

```ts
  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: {
        isActive: true,
        sortOrder: index,
        svgKey: category.svgKey,
        countsTowardTotal: category.countsTowardTotal ?? true,
      },
      create: { ...category, sortOrder: index },
    })
  }

  await normalizeCategorySortOrder()
}
```

- [ ] **Step 4: Run the tests to verify they pass (or skip)**

```bash
npm test -- seed
```

Expected: PASS (or SKIP if `DATABASE_URL` is unreachable in this environment — matches the existing suite's behavior).

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts tests/seed.test.ts
git commit -m "feat: normalize category sortOrder ties as part of seedCategories"
```

**Production note (not a plan step — a deployment reminder):** run `npm run db:seed` once against production as part of shipping this feature, so pre-existing admin-added categories get de-tied before anyone uses the new reorder buttons on them.

---

### Task 3: `createCategory` sortOrder fix and `moveCategory`

**Files:**
- Modify: `src/lib/actions/categories.ts`
- Test: `tests/actions-categories.test.ts` (extend)

**Interfaces:**
- Consumes: `requireAdmin()`, `moveCategorySchema` (Task 1), `prisma.category.aggregate`, `prisma.$transaction` (new use in this file).
- Produces: `createCategory` now computes `sortOrder` server-side (signature unchanged — still `createCategory(input: unknown)`). `moveCategory(input: unknown): Promise<void>` (exported from `src/lib/actions/categories.ts`) — consumed by Task 7's `CategoryRow`.

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-categories.test.ts`. First, extend the mock scaffolding.

Add new mock `const`s (after `const categoryUpdate = vi.fn()`):

```ts
const categoryAggregate = vi.fn()
const txCategoryFindUnique = vi.fn()
const txCategoryFindFirst = vi.fn()
const txCategoryUpdate = vi.fn()
// The interactive-transaction callback is invoked for real here, against a
// fake tx client, so moveCategory's actual swap logic runs in tests — not
// just the top-level prisma mock.
const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    category: {
      findUnique: (...args: unknown[]) => txCategoryFindUnique(...args),
      findFirst: (...args: unknown[]) => txCategoryFindFirst(...args),
      update: (...args: unknown[]) => txCategoryUpdate(...args),
    },
  })
)
```

Update the `@/lib/prisma` mock's `category` block from:

```ts
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findMany: (...args: unknown[]) => categoryFindMany(...args),
      create: (...args: unknown[]) => categoryCreate(...args),
      update: (...args: unknown[]) => categoryUpdate(...args),
    },
  },
}))
```

to:

```ts
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findMany: (...args: unknown[]) => categoryFindMany(...args),
      create: (...args: unknown[]) => categoryCreate(...args),
      update: (...args: unknown[]) => categoryUpdate(...args),
      aggregate: (...args: unknown[]) => categoryAggregate(...args),
    },
    $transaction: (...args: [callback: (tx: unknown) => Promise<unknown>]) => transaction(...args),
  },
}))
```

Update the import line:

```ts
const { listActiveCategories, createCategory, deactivateCategory, createCategoryAction, moveCategory } =
  await import('@/lib/actions/categories')
```

Update `beforeEach` from:

```ts
beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  categoryFindMany.mockReset()
  categoryCreate.mockReset()
  categoryUpdate.mockReset()
})
```

to:

```ts
beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  categoryFindMany.mockReset()
  categoryCreate.mockReset()
  categoryUpdate.mockReset()
  categoryAggregate.mockReset()
  transaction.mockClear()
  txCategoryFindUnique.mockReset()
  txCategoryFindFirst.mockReset()
  txCategoryUpdate.mockReset()
  // Most tests don't care about the max-sortOrder lookup — default it to
  // "no active categories of this type yet" so only the tests that
  // specifically exercise the sortOrder logic need to override it.
  categoryAggregate.mockResolvedValue({ _max: { sortOrder: null } })
})
```

(`transaction` uses `mockClear()`, not `mockReset()`, for the same reason as the attendance-CRUD plan's `deleteCount` tests: its implementation — invoking the callback with the fake `tx` — is fixed behavior every test relies on.)

Replace the existing `describe('createCategory', ...)` block:

```ts
describe('createCategory', () => {
  it('rejects a non-admin before validation', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(createCategory({ name: '', type: 'bogus' })).rejects.toThrow(AuthzError)
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid input for an admin', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(createCategory({ name: '', type: 'SECTION' })).rejects.toThrow()
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('creates the category for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '1' })
    const result = await createCategory({ name: 'Nursery', type: 'CLASSROOM' })
    expect(result).toEqual({ id: '1' })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: true, sortOrder: 0 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('passes an explicit countsTowardTotal: false through to the create call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '2' })
    await createCategory({ name: 'Salvations', type: 'SERVICE_METRIC', countsTowardTotal: false })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Salvations', type: 'SERVICE_METRIC', svgKey: null, countsTowardTotal: false, sortOrder: 0 },
    })
  })

  it('sets sortOrder to one past the current max active same-type sortOrder', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: 4 } })
    categoryCreate.mockResolvedValue({ id: '3' })

    await createCategory({ name: 'Guardians', type: 'SERVE_TEAM' })

    expect(categoryAggregate).toHaveBeenCalledWith({
      where: { type: 'SERVE_TEAM', isActive: true },
      _max: { sortOrder: true },
    })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sortOrder: 5 }),
    })
  })

  it('lands two new categories of the same type at consecutive, non-colliding sortOrders', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryAggregate.mockResolvedValueOnce({ _max: { sortOrder: null } })
    categoryCreate.mockResolvedValueOnce({ id: 'first' })
    await createCategory({ name: 'First', type: 'GROWTH_TRACK' })
    expect(categoryCreate).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ sortOrder: 0 }) })

    categoryAggregate.mockResolvedValueOnce({ _max: { sortOrder: 0 } })
    categoryCreate.mockResolvedValueOnce({ id: 'second' })
    await createCategory({ name: 'Second', type: 'GROWTH_TRACK' })
    expect(categoryCreate).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ sortOrder: 1 }) })
  })
})
```

Add a new `describe` block for `moveCategory`:

```ts
describe('moveCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(moveCategory({ id: 'id1', direction: 'up' })).rejects.toThrow(AuthzError)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects an invalid direction', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(moveCategory({ id: 'id1', direction: 'sideways' })).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('is a graceful no-op when the category no longer exists or is inactive', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: false })

    await expect(moveCategory({ id: 'id1', direction: 'up' })).resolves.toBeUndefined()
    expect(txCategoryFindFirst).not.toHaveBeenCalled()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('is a graceful no-op at the top boundary — no throw, no update', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null) // already first — no smaller sortOrder in this type

    await expect(moveCategory({ id: 'id1', direction: 'up' })).resolves.toBeUndefined()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('is a graceful no-op at the bottom boundary — no throw, no update', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 4, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null) // already last — no larger sortOrder in this type

    await expect(moveCategory({ id: 'id1', direction: 'down' })).resolves.toBeUndefined()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('swaps sortOrder with the adjacent active category of the same type when moving up', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id2', type: 'SECTION', sortOrder: 2, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id1', sortOrder: 1 })

    await moveCategory({ id: 'id2', direction: 'up' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith({
      where: { type: 'SECTION', isActive: true, id: { not: 'id2' }, sortOrder: { lt: 2 } },
      orderBy: { sortOrder: 'desc' },
    })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id2' }, data: { sortOrder: 1 } })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { sortOrder: 2 } })
  })

  it('swaps sortOrder with the adjacent active category of the same type when moving down', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith({
      where: { type: 'SECTION', isActive: true, id: { not: 'id1' }, sortOrder: { gt: 1 } },
      orderBy: { sortOrder: 'asc' },
    })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { sortOrder: 2 } })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id2' }, data: { sortOrder: 1 } })
  })

  it('scopes the neighbor search to the same type — cross-type isolation', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM', sortOrder: 3, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id9', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'up' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'CLASSROOM' }) })
    )
  })

  it('does the read and both writes inside a single transaction', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('revalidates settings and every entry page after a successful swap', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('does not revalidate anything on a graceful no-op', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null)

    await moveCategory({ id: 'id1', direction: 'up' })

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-categories
```

Expected: FAIL — `moveCategory` isn't exported yet, and the existing `createCategory` tests fail their new `sortOrder`/revalidatePath assertions.

- [ ] **Step 3: Implement the `createCategory` fix and `moveCategory`**

Update the import line at the top of `src/lib/actions/categories.ts` from:

```ts
import { createCategorySchema, idSchema } from '@/lib/validation'
```

to:

```ts
import { createCategorySchema, moveCategorySchema, idSchema } from '@/lib/validation'
```

Change `createCategory` from:

```ts
export async function createCategory(input: unknown) {
  await requireAdmin()
  const data = createCategorySchema.parse(input)

  const category = await prisma.category.create({ data })
  revalidatePath('/settings')
  return category
}
```

to:

```ts
export async function createCategory(input: unknown) {
  await requireAdmin()
  const { name, type, svgKey, countsTowardTotal } = createCategorySchema.parse(input)

  // New categories land at the end of their section instead of all
  // colliding at the schema default of 0 — computed server-side, never
  // trusted from the client.
  const { _max } = await prisma.category.aggregate({
    where: { type, isActive: true },
    _max: { sortOrder: true },
  })
  const sortOrder = (_max.sortOrder ?? -1) + 1

  const category = await prisma.category.create({
    data: { name, type, svgKey, countsTowardTotal, sortOrder },
  })
  revalidatePath('/settings')
  revalidatePath('/entry/[eventId]', 'page')
  return category
}
```

Add `moveCategory` to the end of the file:

```ts
/**
 * Swaps sortOrder with the adjacent ACTIVE category of the same type — the
 * up/down reorder buttons. A boundary row (nothing smaller/larger to swap
 * with) is a graceful no-op: it returns normally, never throws, so the UI
 * doesn't need special-case error handling for "you clicked ↑ on the first
 * row" (the button is also disabled there, but this makes the server
 * robust to that being wrong or stale).
 */
export async function moveCategory(input: unknown) {
  await requireAdmin()
  const { id, direction } = moveCategorySchema.parse(input)

  const moved = await prisma.$transaction(async (tx) => {
    const current = await tx.category.findUnique({ where: { id } })
    if (!current || !current.isActive) return false

    const neighbor = await tx.category.findFirst({
      where: {
        type: current.type,
        isActive: true,
        id: { not: current.id },
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
    })
    if (!neighbor) return false // already at this boundary

    await tx.category.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } })
    await tx.category.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } })
    return true
  })

  if (moved) {
    revalidatePath('/settings')
    revalidatePath('/entry/[eventId]', 'page')
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-categories
```

Expected: PASS, all tests including every one added or changed in this task.

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/categories.ts tests/actions-categories.test.ts
git commit -m "feat: give createCategory a real sortOrder and add moveCategory"
```

---

### Task 4: `renameCategory` and `reactivateCategory`

**Files:**
- Modify: `src/lib/actions/categories.ts`
- Test: `tests/actions-categories.test.ts` (extend)

**Interfaces:**
- Consumes: `requireAdmin()`, `renameCategorySchema` (Task 1), `idSchema`, `friendlyValidationMessage`, `prisma.category.findUnique` (new use in this file), `prisma.category.aggregate` (from Task 3).
- Produces: `renameCategory(input: unknown): Promise<void>`, `renameCategoryAction(prevState, formData): Promise<CategoryFormState>`, `reactivateCategory(input: unknown): Promise<void>` (all exported from `src/lib/actions/categories.ts`). Consumed by Task 7's `RenameForm` and `HiddenCategoryRow`.

These re-add (in spirit, not verbatim) the `renameCategory`/`reactivateCategory` actions removed as unused in `d22dd23` — see that commit's diff for the pre-redesign shape. `renameCategory` is unchanged in spirit (still just a name update); `reactivateCategory` now also reassigns `sortOrder` to the end of the active list (the old version didn't, because ordering didn't exist yet).

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-categories.test.ts`. Add a mock (after `const categoryAggregate = vi.fn()` from Task 3):

```ts
const categoryFindUnique = vi.fn()
```

Update the `@/lib/prisma` mock's `category` block to add `findUnique`:

```ts
    category: {
      findMany: (...args: unknown[]) => categoryFindMany(...args),
      create: (...args: unknown[]) => categoryCreate(...args),
      update: (...args: unknown[]) => categoryUpdate(...args),
      aggregate: (...args: unknown[]) => categoryAggregate(...args),
      findUnique: (...args: unknown[]) => categoryFindUnique(...args),
    },
```

Add `categoryFindUnique.mockReset()` to `beforeEach`.

Update the import line:

```ts
const {
  listActiveCategories,
  createCategory,
  deactivateCategory,
  createCategoryAction,
  moveCategory,
  renameCategory,
  renameCategoryAction,
  reactivateCategory,
} = await import('@/lib/actions/categories')
```

Add new `describe` blocks:

```ts
describe('renameCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(renameCategory({ id: 'id1', name: 'New' })).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(renameCategory({ id: 'id1', name: '' })).rejects.toThrow()
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('renames the category and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1', name: 'New Name' })

    await renameCategory({ id: 'id1', name: 'New Name' })

    expect(categoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { name: 'New Name' } })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})

function renameFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('renameCategoryAction', () => {
  it('returns { ok: true } and renames the category for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1', name: 'New Name' })

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'New Name' }))

    expect(result).toEqual({ ok: true })
    expect(categoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { name: 'New Name' } })
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: '' }))

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate name+type instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`,`type`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['name', 'type'] },
      })
    )

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))

    expect(result).toEqual({ ok: false, message: 'A category with that name and type already exists.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockRejectedValue(new Error('connection reset'))

    await expect(
      renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))
    ).rejects.toThrow('connection reset')
  })
})

describe('reactivateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(reactivateCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the category no longer exists', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue(null)
    await expect(reactivateCategory('id1')).rejects.toThrow('No such category')
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('reassigns sortOrder to one past the current max active same-type sortOrder', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: 4 } })

    await reactivateCategory('id1')

    expect(categoryAggregate).toHaveBeenCalledWith({
      where: { type: 'CLASSROOM', isActive: true },
      _max: { sortOrder: true },
    })
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: true, sortOrder: 5 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('starts at sortOrder 0 when no active category of that type exists yet', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: null } })

    await reactivateCategory('id1')

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: true, sortOrder: 0 },
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-categories
```

Expected: FAIL — `renameCategory`, `renameCategoryAction`, and `reactivateCategory` aren't exported yet.

- [ ] **Step 3: Implement `renameCategory`, `renameCategoryAction`, and `reactivateCategory`**

Update the import line at the top of `src/lib/actions/categories.ts` from:

```ts
import { createCategorySchema, moveCategorySchema, idSchema } from '@/lib/validation'
```

to:

```ts
import { createCategorySchema, moveCategorySchema, renameCategorySchema, idSchema } from '@/lib/validation'
```

Add to the end of `src/lib/actions/categories.ts`:

```ts
/**
 * Renaming is safe in a way type/countsTowardTotal changes aren't: records
 * reference the category by id, so history follows the new name — no
 * warning dialog needed, unlike updateCategory().
 */
export async function renameCategory(input: unknown) {
  await requireAdmin()
  const { id, name } = renameCategorySchema.parse(input)

  await prisma.category.update({ where: { id }, data: { name } })
  revalidatePath('/settings')
  revalidatePath('/entry/[eventId]', 'page')
}

/**
 * useActionState-compatible wrapper around renameCategory() for the
 * category manager's inline rename form — same inline-error pattern as
 * createCategoryAction, including the P2002 (duplicate name+type) branch.
 */
export async function renameCategoryAction(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  try {
    await renameCategory({
      id: formData.get('id'),
      name: formData.get('name'),
    })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'A category with that name and type already exists.' }
    }
    throw error
  }
  return { ok: true }
}

/**
 * Un-hides a category and sends it to the end of its type's active list —
 * same rule as createCategory's sortOrder, so a restored category doesn't
 * collide with (or jump ahead of) whatever categories were added while it
 * was hidden.
 */
export async function reactivateCategory(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  const category = await prisma.category.findUnique({ where: { id } })
  if (!category) throw new Error('No such category')

  const { _max } = await prisma.category.aggregate({
    where: { type: category.type, isActive: true },
    _max: { sortOrder: true },
  })
  const sortOrder = (_max.sortOrder ?? -1) + 1

  await prisma.category.update({ where: { id }, data: { isActive: true, sortOrder } })
  revalidatePath('/settings')
  revalidatePath('/entry/[eventId]', 'page')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-categories
```

Expected: PASS, all tests including every one added in this task.

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/categories.ts tests/actions-categories.test.ts
git commit -m "feat: re-add renameCategory and reactivateCategory"
```

---

### Task 5: `updateCategory` and `deleteCategory`

**Files:**
- Modify: `src/lib/actions/categories.ts`
- Test: `tests/actions-categories.test.ts` (extend)

**Interfaces:**
- Consumes: `requireAdmin()`, `updateCategorySchema` (Task 1, redefined), `idSchema`, `prisma.category.update`, `prisma.category.delete` (new use), `prisma.attendanceRecord.count` (new use — first time this file touches the `attendanceRecord` table).
- Produces: `updateCategory(input: unknown): Promise<void>`, `deleteCategory(input: unknown): Promise<void>` (both exported from `src/lib/actions/categories.ts`). Consumed by Task 7's `EditCategoryDialog` and `CategoryRow`'s delete confirmation.

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-categories.test.ts`. Add mocks (after `const categoryFindUnique = vi.fn()` from Task 4):

```ts
const categoryDelete = vi.fn()
const attendanceRecordCount = vi.fn()
```

Update the `@/lib/prisma` mock to add `category.delete` and a new `attendanceRecord` block:

```ts
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findMany: (...args: unknown[]) => categoryFindMany(...args),
      create: (...args: unknown[]) => categoryCreate(...args),
      update: (...args: unknown[]) => categoryUpdate(...args),
      aggregate: (...args: unknown[]) => categoryAggregate(...args),
      findUnique: (...args: unknown[]) => categoryFindUnique(...args),
      delete: (...args: unknown[]) => categoryDelete(...args),
    },
    attendanceRecord: {
      count: (...args: unknown[]) => attendanceRecordCount(...args),
    },
    $transaction: (...args: [callback: (tx: unknown) => Promise<unknown>]) => transaction(...args),
  },
}))
```

Add `categoryDelete.mockReset()` and `attendanceRecordCount.mockReset()` to `beforeEach`.

Update the import line:

```ts
const {
  listActiveCategories,
  createCategory,
  deactivateCategory,
  createCategoryAction,
  moveCategory,
  renameCategory,
  renameCategoryAction,
  reactivateCategory,
  updateCategory,
  deleteCategory,
} = await import('@/lib/actions/categories')
```

Add new `describe` blocks:

```ts
describe('updateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(
      updateCategory({ id: 'id1', type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' })
    ).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects an invalid type', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(
      updateCategory({ id: 'id1', type: 'BOGUS', countsTowardTotal: true, svgKey: null })
    ).rejects.toThrow()
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('keeps svgKey when the type stays SECTION', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' },
    })
  })

  it('clears svgKey server-side when the type changes away from SECTION, even if the caller still sent one', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'CLASSROOM', countsTowardTotal: true, svgKey: 'left-wing' })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'CLASSROOM', countsTowardTotal: true, svgKey: null },
    })
  })

  it('updates countsTowardTotal and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'SERVICE_METRIC', countsTowardTotal: false, svgKey: null })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'SERVICE_METRIC', countsTowardTotal: false, svgKey: null },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})

describe('deleteCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(deleteCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('refuses when the category still has attendance records', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    attendanceRecordCount.mockResolvedValue(3)

    await expect(deleteCategory('id1')).rejects.toThrow(
      'This category has recorded attendance and cannot be deleted — hide it instead.'
    )
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('refuses even when the caller believes the category is unused — a race where a record appeared between render and click', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    // Simulates a volunteer recording a count in the moment between the
    // settings page rendering hasRecords: false and the admin clicking
    // Delete — the server always re-checks, never trusts what the UI last saw.
    attendanceRecordCount.mockResolvedValue(1)

    await expect(deleteCategory('id1')).rejects.toThrow('cannot be deleted')
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('hard-deletes when no attendance records exist, and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    attendanceRecordCount.mockResolvedValue(0)
    categoryDelete.mockResolvedValue({ id: 'id1' })

    await deleteCategory('id1')

    expect(attendanceRecordCount).toHaveBeenCalledWith({ where: { categoryId: 'id1' } })
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: 'id1' } })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-categories
```

Expected: FAIL — `updateCategory` and `deleteCategory` aren't exported yet.

- [ ] **Step 3: Implement `updateCategory` and `deleteCategory`**

Update the import line at the top of `src/lib/actions/categories.ts` from:

```ts
import { createCategorySchema, moveCategorySchema, renameCategorySchema, idSchema } from '@/lib/validation'
```

to:

```ts
import {
  createCategorySchema,
  moveCategorySchema,
  renameCategorySchema,
  updateCategorySchema,
  idSchema,
} from '@/lib/validation'
```

Add to the end of `src/lib/actions/categories.ts`:

```ts
/**
 * Edits type/countsTowardTotal/svgKey — behind the settings UI's required
 * warning dialog, since totals are computed live from these fields and
 * changing them rewrites how every past report groups and totals this
 * category. Changing type away from SECTION always clears svgKey
 * server-side: a non-Sanctuary category can never be placed on the map,
 * regardless of what the client sent.
 */
export async function updateCategory(input: unknown) {
  await requireAdmin()
  const { id, type, countsTowardTotal, svgKey } = updateCategorySchema.parse(input)

  const resolvedSvgKey = type === 'SECTION' ? svgKey : null

  await prisma.category.update({
    where: { id },
    data: { type, countsTowardTotal, svgKey: resolvedSvgKey },
  })
  revalidatePath('/settings')
  revalidatePath('/entry/[eventId]', 'page')
}

/**
 * Hard-deletes a category — offered only when it has zero attendance
 * records. Re-checks that server-side (never trusts the UI's hasRecords
 * flag, which only controls whether the Delete button renders) so a record
 * created between the page rendering and the admin clicking Delete still
 * blocks the delete. The DB's onDelete: Restrict on AttendanceRecord's
 * category relation is the backstop if this check is ever bypassed.
 */
export async function deleteCategory(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  const recordCount = await prisma.attendanceRecord.count({ where: { categoryId: id } })
  if (recordCount > 0) {
    throw new Error('This category has recorded attendance and cannot be deleted — hide it instead.')
  }

  await prisma.category.delete({ where: { id } })
  revalidatePath('/settings')
  revalidatePath('/entry/[eventId]', 'page')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-categories
```

Expected: PASS, all tests including every one added in this task.

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/categories.ts tests/actions-categories.test.ts
git commit -m "feat: add updateCategory and deleteCategory"
```

---

### Task 6: Events — `listRecentEvents`, `unarchiveEvent`, and revalidation extensions

**Files:**
- Modify: `src/lib/actions/events.ts`
- Test: `tests/actions-events.test.ts` (extend)

**Interfaces:**
- Consumes: `requireAdmin()`, `createEventSchema` (existing), `friendlyValidationMessage`, `AuthzError` (from `src/lib/authz.ts`, not currently imported in this file).
- Produces: `listRecentEvents(): Promise<Event[]>`, `unarchiveEvent(input: unknown): Promise<void>`, `createEventAction(prevState, formData): Promise<EventFormState>` (all exported from `src/lib/actions/events.ts`). Consumed by Task 8's `ServicesSection`.

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-events.test.ts`. Add `import { Prisma } from '@prisma/client'` at the top, alongside the existing `import { describe, it, expect, vi, beforeEach } from 'vitest'`.

Update the import line from:

```ts
const { listEvents, createEvent, archiveEvent, getOrCreateTodayEvent, listEventsInRange } = await import(
  '@/lib/actions/events'
)
```

to:

```ts
const {
  listEvents,
  createEvent,
  archiveEvent,
  getOrCreateTodayEvent,
  listEventsInRange,
  unarchiveEvent,
  listRecentEvents,
  createEventAction,
} = await import('@/lib/actions/events')
```

Update the existing `createEvent` test — change:

```ts
  it('creates the event and revalidates for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
    const result = await createEvent({ name: 'Sunday', serviceDate: '2026-08-09' })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Sunday', serviceDate: '2026-08-09' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(result).toEqual({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
  })
```

to:

```ts
  it('creates the event and revalidates for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
    const result = await createEvent({ name: 'Sunday', serviceDate: '2026-08-09' })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Sunday', serviceDate: '2026-08-09' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(result).toEqual({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
  })
```

Update the existing `archiveEvent` test — change:

```ts
  it('archives the event for a valid admin call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await archiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: true } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
  })
```

to:

```ts
  it('archives the event and revalidates dashboard, settings, and its own entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await archiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: true } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
  })
```

Add new `describe` blocks at the end of the file:

```ts
describe('unarchiveEvent', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(unarchiveEvent('id1')).rejects.toThrow(AuthzError)
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty id', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(unarchiveEvent('')).rejects.toThrow()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('un-archives the event and revalidates dashboard, settings, and its own entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await unarchiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: false } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
  })
})

describe('listRecentEvents', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(listRecentEvents()).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('returns events including archived ones, most recent first', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([{ id: '1', isArchived: true }])
    const result = await listRecentEvents()
    expect(result).toEqual([{ id: '1', isArchived: true }])
    expect(eventFindMany).toHaveBeenCalledWith({
      orderBy: [{ serviceDate: 'desc' }, { name: 'asc' }],
      take: 50,
    })
  })
})

function eventFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('createEventAction', () => {
  it('returns { ok: true } and creates the event for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({ id: '1' })

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06' })
    )

    expect(result).toEqual({ ok: true })
    expect(eventCreate).toHaveBeenCalledWith({ data: { name: 'Sunday Service', serviceDate: '2026-09-06' } })
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await createEventAction({ ok: true }, eventFormData({ name: '', serviceDate: '2026-09-06' }))

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate [serviceDate, name] instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06' })
    )

    expect(result).toEqual({ ok: false, message: 'A service with that name already exists on that date.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockRejectedValue(new Error('connection reset'))

    await expect(
      createEventAction({ ok: true }, eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06' }))
    ).rejects.toThrow('connection reset')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-events
```

Expected: FAIL — `unarchiveEvent`, `listRecentEvents`, and `createEventAction` aren't exported yet, and the updated `createEvent`/`archiveEvent` assertions fail against the current revalidation calls.

- [ ] **Step 3: Implement the changes**

Update the imports at the top of `src/lib/actions/events.ts` from:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/authz'
import { createEventSchema, serviceDateSchema, idSchema } from '@/lib/validation'
import { todayServiceDate, formatServiceDate } from '@/lib/dates'
```

to:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser, AuthzError } from '@/lib/authz'
import { createEventSchema, serviceDateSchema, idSchema, friendlyValidationMessage } from '@/lib/validation'
import { todayServiceDate, formatServiceDate } from '@/lib/dates'
```

Change `createEvent` from:

```ts
export async function createEvent(input: unknown) {
  await requireAdmin()
  const { name, serviceDate } = createEventSchema.parse(input)

  const event = await prisma.event.create({ data: { name, serviceDate } })
  revalidatePath('/dashboard')
  return event
}
```

to:

```ts
export async function createEvent(input: unknown) {
  await requireAdmin()
  const { name, serviceDate } = createEventSchema.parse(input)

  const event = await prisma.event.create({ data: { name, serviceDate } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  return event
}
```

Change `archiveEvent` from:

```ts
export async function archiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: true } })
  revalidatePath('/dashboard')
}
```

to:

```ts
export async function archiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: true } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/entry/${id}`)
}
```

Add to the end of `src/lib/actions/events.ts`:

```ts
/** Symmetric with archiveEvent — a mistaken archive must be reversible from the UI. */
export async function unarchiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: false } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/entry/${id}`)
}

/**
 * Every service, most recent first, INCLUDING archived ones — unlike
 * listEvents() (which powers the volunteer dashboard and hides archived
 * services on purpose). Powers the admin-only Settings "Services" list,
 * where seeing — and un-archiving — a mistakenly archived service is the
 * point.
 */
export async function listRecentEvents() {
  await requireAdmin()
  return prisma.event.findMany({
    orderBy: [{ serviceDate: 'desc' }, { name: 'asc' }],
    take: 50,
  })
}

export type EventFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around createEvent() for the Settings
 * page's "Create a service" form — same inline-error pattern as
 * createCategoryAction. The @@unique([serviceDate, name]) constraint means
 * a duplicate name on the same date surfaces as P2002.
 */
export async function createEventAction(
  _prevState: EventFormState,
  formData: FormData
): Promise<EventFormState> {
  try {
    await createEvent({
      name: formData.get('name'),
      serviceDate: formData.get('serviceDate'),
    })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'A service with that name already exists on that date.' }
    }
    throw error
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-events
```

Expected: PASS, all tests including every one added or changed in this task.

- [ ] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/events.ts tests/actions-events.test.ts
git commit -m "feat: add listRecentEvents, unarchiveEvent, and createEventAction"
```

---

### Task 7: Category manager UI

**Files:**
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/EditCategoryDialog.tsx`
- Create: `src/components/CategorySection.tsx`
- Modify: `src/components/AddCategoryForm.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `moveCategory`, `renameCategoryAction`, `deactivateCategory`, `reactivateCategory`, `updateCategory`, `deleteCategory`, `createCategoryAction`, `type CategoryFormState` (all from `src/lib/actions/categories.ts`, Tasks 3–5 and the existing `deactivateCategory`/`createCategoryAction`), `TYPE_LABELS` (`src/lib/category-labels.ts`), `MAP_REGIONS` (`src/lib/map-regions.ts`).
- Produces: `ConfirmDialog` (exported from `src/components/ConfirmDialog.tsx`) — reused by Task 8's Archive confirmation. `CategoryRowData` type and `CategorySection` component (exported from `src/components/CategorySection.tsx`), rendered once per `CategoryType` by the rewritten `settings/page.tsx`.

This task is UI wiring around already-tested Server Actions — matching this project's convention of not adding new automated tests for pure UI composition (see the attendance-CRUD plan's Task 4). Verification here is a type-check, the full existing suite staying green, and the manual checklist in Task 9.

- [ ] **Step 1: Create the shared `ConfirmDialog`**

Create `src/components/ConfirmDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'

/**
 * The required-confirmation warning dialog used wherever an action needs
 * more friction than a plain button but isn't complex enough to need its
 * own form (Delete category, Archive service). NOT window.confirm() — a
 * checkbox must be explicitly checked before the destructive/impactful
 * button enables, per the settings redesign spec.
 */
export function ConfirmDialog({
  title,
  warningText,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string
  warningText: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setStatus('saving')
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not complete that action — please try again.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(24rem, 100%)', display: 'grid', gap: 'var(--space-3)' }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>

        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
            padding: 'var(--space-3)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius)',
          }}
        >
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>{warningText}</span>
        </label>

        {status === 'error' && error && (
          <p role="alert" style={{ color: 'var(--color-danger)', margin: 0 }}>
            <span aria-hidden="true">⚠</span> {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={confirm}
            disabled={!acknowledged || status === 'saving'}
            style={{
              flex: 2, fontWeight: 700,
              background: danger ? 'var(--color-danger)' : 'var(--color-accent)',
              color: 'var(--color-accent-contrast)',
            }}
          >
            {status === 'saving' ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `EditCategoryDialog`**

Create `src/components/EditCategoryDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { CategoryType } from '@prisma/client'
import { updateCategory } from '@/lib/actions/categories'
import { MAP_REGIONS } from '@/lib/map-regions'
import { TYPE_LABELS } from '@/lib/category-labels'

/**
 * Edits type/countsTowardTotal/svgKey behind a required warning — separate
 * from ConfirmDialog because it needs real form fields (not just a
 * checkbox), but follows the same "required confirmation checkbox, not
 * window.confirm()" pattern.
 */
export function EditCategoryDialog({
  category,
  sanctuarySvgKeys,
  onClose,
  onSaved,
}: {
  category: { id: string; name: string; type: CategoryType; svgKey: string | null; countsTowardTotal: boolean }
  /** Every currently-taken Sanctuary map region, across all sections (not just this category's own). */
  sanctuarySvgKeys: { id: string; svgKey: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<CategoryType>(category.type)
  const [countsTowardTotal, setCountsTowardTotal] = useState(category.countsTowardTotal)
  const [svgKey, setSvgKey] = useState<string>(category.svgKey ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const takenByOthers = sanctuarySvgKeys.filter((s) => s.id !== category.id).map((s) => s.svgKey)

  async function save() {
    setStatus('saving')
    setError(null)
    const resolvedSvgKey = type === 'SECTION' ? svgKey || null : null
    try {
      await updateCategory({ id: category.id, type, countsTowardTotal, svgKey: resolvedSvgKey })
      onSaved()
      onClose()
    } catch {
      setStatus('error')
      setError('Could not save — please try again.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${category.name}`}
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(28rem, 100%)', display: 'grid', gap: 'var(--space-3)' }}>
        <h2 style={{ marginTop: 0 }}>Edit {category.name}</h2>

        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CategoryType)}
            style={{ padding: 'var(--space-3)' }}
          >
            {(Object.keys(TYPE_LABELS) as CategoryType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>

        {type === 'SECTION' && (
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            Map region
            <select value={svgKey} onChange={(e) => setSvgKey(e.target.value)} style={{ padding: 'var(--space-3)' }}>
              <option value="">Not on the map (shows in the list)</option>
              {MAP_REGIONS.map((region) => (
                <option key={region.key} value={region.key} disabled={takenByOthers.includes(region.key)}>
                  {region.label}
                  {takenByOthers.includes(region.key) ? ' (taken)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            type="checkbox"
            checked={countsTowardTotal}
            onChange={(e) => setCountsTowardTotal(e.target.checked)}
          />
          Counts toward Total Attendance
        </label>

        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
            padding: 'var(--space-3)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius)',
          }}
        >
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>This changes how every past report groups and totals this category.</span>
        </label>

        {status === 'error' && error && (
          <p role="alert" style={{ color: 'var(--color-danger)', margin: 0 }}>
            <span aria-hidden="true">⚠</span> {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={save}
            disabled={!acknowledged || status === 'saving'}
            style={{ flex: 2, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700 }}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `AddCategoryForm` to take a fixed `type`**

Replace the full contents of `src/components/AddCategoryForm.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { CategoryType } from '@prisma/client'
import { createCategoryAction, type CategoryFormState } from '@/lib/actions/categories'
import { MAP_REGIONS } from '@/lib/map-regions'

const initialState: CategoryFormState = { ok: true }

/**
 * type is fixed per section (no dropdown) — sent to createCategoryAction as
 * a hidden input, so the FormData shape (and createCategoryAction's parsing
 * of it) is unchanged from before this component took a `type` prop.
 */
export function AddCategoryForm({
  type,
  showSvgKey,
  showCountsToggle,
  takenSvgKeys,
}: {
  type: CategoryType
  showSvgKey: boolean
  showCountsToggle: boolean
  takenSvgKeys: string[]
}) {
  const [state, formAction, pending] = useActionState(createCategoryAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input type="hidden" name="type" value={type} />
      <input name="name" placeholder="Name" required maxLength={60} style={{ padding: 'var(--space-3)' }} />

      {showSvgKey && (
        <select name="svgKey" style={{ padding: 'var(--space-3)' }}>
          <option value="">Not on the map (shows in the list)</option>
          {MAP_REGIONS.map((region) => (
            <option key={region.key} value={region.key} disabled={takenSvgKeys.includes(region.key)}>
              {region.label}
              {takenSvgKeys.includes(region.key) ? ' (taken)' : ''}
            </option>
          ))}
        </select>
      )}

      {showCountsToggle ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="checkbox" name="countsTowardTotal" defaultChecked />
          Counts toward Total Attendance
        </label>
      ) : (
        // Every section except Ministry Metrics counts toward the total by
        // default, with no visible toggle. A hidden input (rather than
        // simply omitting the field) keeps createCategoryAction's
        // `formData.get('countsTowardTotal') === 'on'` check working
        // exactly as it does when the checkbox above is checked.
        <input type="hidden" name="countsTowardTotal" value="on" />
      )}

      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add category'}</button>
    </form>
  )
}
```

- [ ] **Step 4: Create `CategorySection`**

Create `src/components/CategorySection.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { CategoryType } from '@prisma/client'
import { AddCategoryForm } from '@/components/AddCategoryForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EditCategoryDialog } from '@/components/EditCategoryDialog'
import {
  moveCategory,
  deactivateCategory,
  reactivateCategory,
  deleteCategory,
  renameCategoryAction,
  type CategoryFormState,
} from '@/lib/actions/categories'

export type CategoryRowData = {
  id: string
  name: string
  type: CategoryType
  svgKey: string | null
  sortOrder: number
  isActive: boolean
  countsTowardTotal: boolean
  hasRecords: boolean
}

const renameInitialState: CategoryFormState = { ok: true }

function RenameForm({ category, onDone }: { category: CategoryRowData; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(renameCategoryAction, renameInitialState)
  // useActionState's initial state is { ok: true } — indistinguishable from
  // a real successful save unless we track whether a submission actually
  // happened. Without this, the effect below would fire on mount (state.ok
  // is already true before any submit) and instantly close the form.
  const submittedRef = useRef(false)

  useEffect(() => {
    if (submittedRef.current && state.ok) onDone()
  }, [state, onDone])

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submittedRef.current = true
      }}
      style={{ display: 'flex', gap: 'var(--space-2)', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input type="hidden" name="id" value={category.id} />
      <input
        name="name"
        defaultValue={category.name}
        required
        maxLength={60}
        style={{ flex: 1, padding: 'var(--space-2)' }}
      />
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={onDone}>Cancel</button>
      {!state.ok && state.message && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{state.message}</p>
      )}
    </form>
  )
}

function CategoryRow({
  category,
  isFirst,
  isLast,
  sanctuarySvgKeys,
}: {
  category: CategoryRowData
  isFirst: boolean
  isLast: boolean
  sanctuarySvgKeys: { id: string; svgKey: string }[]
}) {
  const [mode, setMode] = useState<'view' | 'renaming' | 'editing' | 'deleting'>('view')
  const [busy, setBusy] = useState<'up' | 'down' | 'hide' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function move(direction: 'up' | 'down') {
    setBusy(direction)
    setError(null)
    try {
      await moveCategory({ id: category.id, direction })
    } catch {
      setError('Could not reorder — please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function hide() {
    setBusy('hide')
    setError(null)
    try {
      await deactivateCategory(category.id)
    } catch {
      setError('Could not hide — please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (mode === 'renaming') {
    return (
      <div style={{ padding: 'var(--space-2) 0' }}>
        <RenameForm category={category} onDone={() => setMode('view')} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', gap: 'var(--space-2)',
      }}
    >
      <span>{category.name}</span>
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
        <button onClick={() => move('up')} disabled={isFirst || busy !== null} aria-label={`Move ${category.name} up`}>↑</button>
        <button onClick={() => move('down')} disabled={isLast || busy !== null} aria-label={`Move ${category.name} down`}>↓</button>
        <button onClick={() => setMode('renaming')}>Rename</button>
        <button onClick={() => setMode('editing')}>Edit</button>
        <button onClick={hide} disabled={busy !== null}>Hide</button>
        {!category.hasRecords && <button onClick={() => setMode('deleting')}>Delete</button>}
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>
      )}

      {mode === 'editing' && (
        <EditCategoryDialog
          category={category}
          sanctuarySvgKeys={sanctuarySvgKeys}
          onClose={() => setMode('view')}
          onSaved={() => setMode('view')}
        />
      )}

      {mode === 'deleting' && (
        <ConfirmDialog
          title={`Delete ${category.name}?`}
          warningText="This permanently removes the category. This cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            await deleteCategory(category.id)
            setMode('view')
          }}
        />
      )}
    </div>
  )
}

function HiddenCategoryRow({ category }: { category: CategoryRowData }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function show() {
    setBusy(true)
    setError(null)
    try {
      await reactivateCategory(category.id)
    } catch {
      setError('Could not restore — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', opacity: 0.6,
      }}
    >
      <span>{category.name}</span>
      <button onClick={show} disabled={busy}>{busy ? 'Restoring…' : 'Show'}</button>
      {error && <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>}
    </div>
  )
}

export function CategorySection({
  type,
  label,
  categories,
  sanctuarySvgKeys,
}: {
  type: CategoryType
  label: string
  categories: CategoryRowData[]
  /** Every currently-taken Sanctuary map region, across all sections. */
  sanctuarySvgKeys: { id: string; svgKey: string }[]
}) {
  const active = [...categories.filter((c) => c.isActive)].sort((a, b) => a.sortOrder - b.sortOrder)
  const hidden = categories.filter((c) => !c.isActive)

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 style={{ marginTop: 0 }}>{label}</h2>

      {active.map((category, index) => (
        <CategoryRow
          key={category.id}
          category={category}
          isFirst={index === 0}
          isLast={index === active.length - 1}
          sanctuarySvgKeys={sanctuarySvgKeys}
        />
      ))}

      {hidden.length > 0 && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary>Hidden ({hidden.length})</summary>
          {hidden.map((category) => (
            <HiddenCategoryRow key={category.id} category={category} />
          ))}
        </details>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <AddCategoryForm
          type={type}
          showSvgKey={type === 'SECTION'}
          showCountsToggle={type === 'SERVICE_METRIC'}
          takenSvgKeys={sanctuarySvgKeys.map((s) => s.svgKey)}
        />
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Wire `CategorySection` into `settings/page.tsx`**

Replace the full contents of `src/app/settings/page.tsx`:

```tsx
import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
import { CategorySection, type CategoryRowData } from '@/components/CategorySection'
import { TYPE_LABELS } from '@/lib/category-labels'
import type { CategoryType } from '@prisma/client'

export default async function SettingsPage() {
  // Page-level gate. The actions below each re-check independently — this
  // call is convenience, not the boundary. On AuthzError it redirects to
  // /denied instead of leaving Next's raw error screen as the only outcome.
  await requireAdminPage()

  const [categoryRecords, allowlist] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { records: true } } },
    }),
    listAllowlist(),
  ])

  const categories: CategoryRowData[] = categoryRecords.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    svgKey: c.svgKey,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    countsTowardTotal: c.countsTowardTotal,
    hasRecords: c._count.records > 0,
  }))

  // Every currently-taken Sanctuary map region, across all sections — used
  // both by each section's Add form and by the Edit dialog (which can move
  // any category INTO Sanctuary, not just edit ones already there).
  const sanctuarySvgKeys = categories
    .filter((c): c is CategoryRowData & { svgKey: string } => c.type === 'SECTION' && c.isActive && Boolean(c.svgKey))
    .map((c) => ({ id: c.id, svgKey: c.svgKey }))

  const categoryTypes = Object.keys(TYPE_LABELS) as CategoryType[]

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

      {categoryTypes.map((type) => (
        <CategorySection
          key={type}
          type={type}
          label={TYPE_LABELS[type]}
          categories={categories.filter((c) => c.type === type)}
          sanctuarySvgKeys={sanctuarySvgKeys}
        />
      ))}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Who can sign in</h2>
        <AddAllowlistForm />

        {allowlist.map((entry) => (
          <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
            <span style={{ opacity: entry.isActive ? 1 : 0.5 }}>
              {entry.email} <small style={{ color: 'var(--color-text-muted)' }}>({entry.role})</small>
            </span>
            {entry.isActive && (
              <form action={async () => { 'use server'; await deactivateAllowlistEntry(entry.id) }}>
                <button type="submit">Revoke</button>
              </form>
            )}
          </div>
        ))}
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Revoking takes effect immediately — the next action that person attempts is refused.
        </p>
      </section>

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
    </main>
  )
}
```

(Task 8 adds the Services section above the category loop; the export and allowlist sections above are otherwise final.)

- [ ] **Step 6: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all passing — this task adds no new automated tests but must not break anything existing.

- [ ] **Step 8: Commit**

```bash
git add src/components/ConfirmDialog.tsx src/components/EditCategoryDialog.tsx src/components/CategorySection.tsx src/components/AddCategoryForm.tsx src/app/settings/page.tsx
git commit -m "feat: add the category manager UI to Settings"
```

---

### Task 8: Services section UI

**Files:**
- Create: `src/components/ServicesSection.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `createEventAction`, `archiveEvent`, `unarchiveEvent`, `listRecentEvents`, `type EventFormState` (all from `src/lib/actions/events.ts`, Task 6), `nextSundayServiceDate` (`src/lib/dates.ts`, Task 1), `formatServiceDate` (`src/lib/dates.ts`, existing), `ConfirmDialog` (`src/components/ConfirmDialog.tsx`, Task 7).
- Produces: `ServiceRowData` type and `ServicesSection` component (exported from `src/components/ServicesSection.tsx`), rendered once by `settings/page.tsx`, above the category sections.

Same convention as Task 7: pure UI wiring around already-tested Server Actions, no new automated tests. Verification is a type-check, the full suite staying green, and the manual checklist in Task 9.

- [ ] **Step 1: Create `ServicesSection`**

Create `src/components/ServicesSection.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createEventAction, archiveEvent, unarchiveEvent, type EventFormState } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export type ServiceRowData = {
  id: string
  name: string
  serviceDate: string
  isArchived: boolean
}

const initialState: EventFormState = { ok: true }

function CreateServiceForm({ defaultServiceDate }: { defaultServiceDate: string }) {
  const [state, formAction, pending] = useActionState(createEventAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input name="name" placeholder="Service name" required maxLength={80} style={{ padding: 'var(--space-3)' }} />
      <input
        name="serviceDate"
        type="date"
        defaultValue={defaultServiceDate}
        required
        style={{ padding: 'var(--space-3)' }}
      />
      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create service'}</button>
    </form>
  )
}

function ServiceRow({ service }: { service: ServiceRowData }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unarchive() {
    setBusy(true)
    setError(null)
    try {
      await unarchiveEvent(service.id)
    } catch {
      setError('Could not restore — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', opacity: service.isArchived ? 0.6 : 1,
      }}
    >
      <span>
        {service.name}{' '}
        <small style={{ color: 'var(--color-text-muted)' }}>
          ({formatServiceDate(service.serviceDate)}{service.isArchived ? ', archived' : ''})
        </small>
      </span>

      {service.isArchived ? (
        <button onClick={unarchive} disabled={busy}>{busy ? 'Restoring…' : 'Unarchive'}</button>
      ) : (
        <button onClick={() => setConfirming(true)}>Archive</button>
      )}

      {error && <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>}

      {confirming && (
        <ConfirmDialog
          title={`Archive ${service.name}?`}
          warningText="An archived service stops accepting counts and edits."
          confirmLabel="Archive"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await archiveEvent(service.id)
            setConfirming(false)
          }}
        />
      )}
    </div>
  )
}

export function ServicesSection({
  services,
  defaultServiceDate,
}: {
  services: ServiceRowData[]
  defaultServiceDate: string
}) {
  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 style={{ marginTop: 0 }}>Services</h2>
      <CreateServiceForm defaultServiceDate={defaultServiceDate} />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {services.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Wire `ServicesSection` into `settings/page.tsx`**

Update the imports at the top of `src/app/settings/page.tsx` — change:

```tsx
import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
import { CategorySection, type CategoryRowData } from '@/components/CategorySection'
import { TYPE_LABELS } from '@/lib/category-labels'
import type { CategoryType } from '@prisma/client'
```

to:

```tsx
import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { listRecentEvents } from '@/lib/actions/events'
import { nextSundayServiceDate } from '@/lib/dates'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
import { CategorySection, type CategoryRowData } from '@/components/CategorySection'
import { ServicesSection, type ServiceRowData } from '@/components/ServicesSection'
import { TYPE_LABELS } from '@/lib/category-labels'
import type { CategoryType } from '@prisma/client'
```

Change the data fetch from:

```tsx
  const [categoryRecords, allowlist] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { records: true } } },
    }),
    listAllowlist(),
  ])
```

to:

```tsx
  const [categoryRecords, allowlist, events] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { records: true } } },
    }),
    listAllowlist(),
    listRecentEvents(),
  ])

  const services: ServiceRowData[] = events.map((e) => ({
    id: e.id,
    name: e.name,
    serviceDate: e.serviceDate,
    isArchived: e.isArchived,
  }))
  const defaultServiceDate = nextSundayServiceDate()
```

Add the `ServicesSection` above the category-sections loop — change:

```tsx
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

      {categoryTypes.map((type) => (
```

to:

```tsx
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

      <ServicesSection services={services} defaultServiceDate={defaultServiceDate} />

      {categoryTypes.map((type) => (
```

- [ ] **Step 3: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/ServicesSection.tsx src/app/settings/page.tsx
git commit -m "feat: add the Services section to Settings"
```

---

### Task 9: Full-suite verification and manual sign-off

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

Expected: all specs passing, including every test added across Tasks 1–6.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Production reminder**

Confirm `npm run db:seed` has been (or will be) run once against production as part of shipping this feature — see Task 2's normalization note. This is not a code change, just a deployment step to not forget.

- [ ] **Step 5: Manual verification**

Start the dev server, sign in as admin, and open `/settings`:

**Category manager**

1. Confirm five sections appear, in order: Sanctuary, Classrooms, Growth Track, Serve Teams, Ministry Metrics — each showing only its own active categories, ordered by the existing `sortOrder`.
2. In the Sanctuary section's Add form, confirm the map-region dropdown shows already-assigned regions marked "(taken)" but still lets you pick an unassigned one. In every other section's Add form, confirm there's no map-region dropdown at all.
3. In the Ministry Metrics section's Add form, confirm the "Counts toward Total Attendance" checkbox is visible and defaults checked. In every other section, confirm there's no such checkbox (and that a category added there still counts toward the total in Reports).
4. Add a new category in a section with existing active categories. Confirm it appears at the END of that section's active list (not inserted at the top), and does NOT show up in any other section.
5. Use ↑/↓ on a middle row; confirm it swaps position with its neighbor. Confirm the first row's ↑ is disabled and the last row's ↓ is disabled.
6. Click Rename on a row, change the name, Save. Confirm the row updates in place. Try renaming to a name that collides with another category of the same type; confirm an inline error appears (no crash) and the name is unchanged.
7. Click Edit on a row. Confirm the dialog's Save button is disabled until the warning checkbox is checked. Change the type to something else, confirm Sanctuary's map-region field disappears from the dialog when the type isn't SECTION, save, and confirm the row now appears under its new type's section (and, if it had a map region, that the region shows as available again for other Sanctuary categories).
8. Click Hide on a row; confirm it moves into that section's "Hidden (n)" disclosure and disappears from `/entry/<eventId>` for a live event (after a refresh).
9. Expand "Hidden (n)", click Show on a row; confirm it returns to the end of the active list and reappears on `/entry/<eventId>`.
10. On a category with zero attendance records, confirm a Delete button is present; click it, confirm the same required-checkbox warning dialog pattern, confirm it, and confirm the category is gone entirely (not just hidden).
11. On a category WITH attendance records, confirm no Delete button renders at all.

**Services section**

12. Confirm the "Create a service" date field defaults to the upcoming Sunday (or today, if today is Sunday).
13. Create a service; confirm it appears at the top of the Recent services list. Try creating a duplicate name on the same date; confirm an inline error appears (no crash).
14. Click Archive on an active service; confirm the required-checkbox warning dialog, confirm it, and confirm the row shows as archived. Confirm `/entry/<that eventId>` now returns not-found (or is otherwise blocked) for a volunteer.
15. Click Unarchive on an archived service (no warning dialog expected here); confirm it becomes active again and `/entry/<that eventId>` works again.

**Cross-cutting**

16. Sign in as a VOLUNTEER-role account (or reason through the code if a second test account isn't available): confirm `/settings` is not reachable (redirects to `/denied`), and that none of the new actions can be invoked directly (each independently calls `requireAdmin()`).
17. With two browser tabs open to `/settings`, hide a category from a category with zero records in one tab, then in the other tab (before refreshing) attempt to add an attendance record for that category via `/entry` in a third context, then return and try Delete from the first tab's stale render — confirm the server-side re-check refuses the delete with a friendly message rather than crashing or silently deleting.

If any step fails, fix the underlying issue, re-run Steps 1–3, and repeat the failed manual step before considering this plan complete.
