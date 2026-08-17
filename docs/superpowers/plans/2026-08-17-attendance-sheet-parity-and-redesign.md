# Attendance Sheet Parity & Accessible Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the app's tracked categories in line with the church's real paper attendance sheet, and make the UI colorblind-safe and legible (higher contrast, larger type, light/dark support).

**Architecture:** Extend the existing `Category`/`CategoryType` model with two new type values (`GROWTH_TRACK`, `SERVICE_METRIC`) and one new field (`countsTowardTotal`), rewrite the seed data to match the real category list, restructure the entry screen to render one heading+layout per category type instead of a single flat list, and rework the CSS custom-property token system for a light-default / dark-media-query palette.

**Tech Stack:** Next.js 16 (App Router), Prisma 6.19.3 + PostgreSQL (Neon), Zod, Vitest, plain CSS custom properties (no new dependency).

## Global Constraints

- No hard deletes of categories — always `isActive: false` (soft delete), never `.delete()`. `AttendanceRecord.category` is `onDelete: Restrict` at the DB level, so this is enforced structurally, not just by convention.
- `countsTowardTotal` and `type` are set once at category creation; no edit action exists or should be added for either (existing convention — see Task 12 ledger entry in `.superpowers/sdd/2026-08-09-church-attendance-app-plan/progress.md`).
- No new runtime dependency for theming — extend `src/styles/tokens.css` in place.
- No church-specific branding text added to the UI.
- Every Server Action re-checks `requireUser()`/`requireAdmin()` independently — never rely on a page-level check as the boundary (existing project convention, unaffected by this plan but must not be broken by any edit).
- Spec reference: `docs/superpowers/specs/2026-08-17-attendance-sheet-parity-and-redesign.md`.

---

### Task 1: Schema, validation, and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/validation.ts`
- Modify: `tests/validation.test.ts`
- Create: a Prisma migration (via CLI, not hand-written)

**Interfaces:**
- Produces: `CategoryType` enum now has 5 values (`SECTION`, `CLASSROOM`, `GROWTH_TRACK`, `SERVE_TEAM`, `SERVICE_METRIC`). `Category.countsTowardTotal: boolean`, DB default `true`. `categoryTypeSchema` (Zod) accepts all 5 values. `createCategorySchema` (Zod) has a new field `countsTowardTotal: boolean`, default `true`.

- [ ] **Step 1: Update the Prisma schema**

In `prisma/schema.prisma`, replace the `CategoryType` enum and add the new field to `Category`:

```prisma
enum CategoryType {
  SECTION
  CLASSROOM
  GROWTH_TRACK
  SERVE_TEAM
  SERVICE_METRIC
}
```

```prisma
model Category {
  id                String             @id @default(cuid())
  name              String
  type              CategoryType
  sortOrder         Int                @default(0)
  /// Key of a fixed region in the SVG sanctuary map. Null = appears in the list only.
  svgKey            String?
  /// Whether this category's count is included in the report's Total Attendance.
  /// False for ministry metrics (Salvations, Connection Cards, Welcome Packs) that
  /// track something other than a headcount and would double-count people already
  /// counted elsewhere.
  countsTowardTotal Boolean            @default(true)
  isActive          Boolean            @default(true)
  createdAt         DateTime           @default(now())
  records           AttendanceRecord[]

  @@unique([name, type])
  @@index([type, sortOrder])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run from the repo root in WSL:

```bash
cd ~/projects/church-attendance/church-attendance-app
npx prisma migrate dev --name add_growth_track_and_service_metric_categories
```

Expected: Prisma prints a new migration under `prisma/migrations/`, applies it to the dev database, and regenerates the client. Confirm no errors and that `npx prisma studio` (or `npx prisma db pull` dry-run) is not required — `migrate dev` handles both apply and generate.

- [ ] **Step 3: Update `categoryTypeSchema` and `createCategorySchema`**

In `src/lib/validation.ts`, change:

```ts
export const categoryTypeSchema = z.enum(['SECTION', 'CLASSROOM', 'SERVE_TEAM'])
```

to:

```ts
export const categoryTypeSchema = z.enum([
  'SECTION',
  'CLASSROOM',
  'GROWTH_TRACK',
  'SERVE_TEAM',
  'SERVICE_METRIC',
])
```

and change:

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  type: categoryTypeSchema,
  svgKey: z.string().trim().max(40).nullable().default(null),
})
```

to:

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  type: categoryTypeSchema,
  svgKey: z.string().trim().max(40).nullable().default(null),
  countsTowardTotal: z.boolean().default(true),
})
```

- [ ] **Step 4: Write the new validation tests**

Add to `tests/validation.test.ts`, inside (or right after) the existing `describe('createCategorySchema', ...)` block:

```ts
describe('categoryTypeSchema', () => {
  it('accepts all five category types', () => {
    for (const type of ['SECTION', 'CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC']) {
      expect(categoryTypeSchema.parse(type)).toBe(type)
    }
  })
})

describe('createCategorySchema — countsTowardTotal', () => {
  it('defaults countsTowardTotal to true when omitted', () => {
    const result = createCategorySchema.parse({ name: 'Left Wing', type: 'SECTION', svgKey: null })
    expect(result.countsTowardTotal).toBe(true)
  })

  it('accepts an explicit countsTowardTotal of false', () => {
    const result = createCategorySchema.parse({
      name: 'Salvations',
      type: 'SERVICE_METRIC',
      svgKey: null,
      countsTowardTotal: false,
    })
    expect(result.countsTowardTotal).toBe(false)
  })
})
```

Add `categoryTypeSchema` to the existing `import { ... } from '@/lib/validation'` line at the top of the file if it isn't already imported.

- [ ] **Step 5: Run the tests**

```bash
npm test -- validation
```

Expected: all tests in `tests/validation.test.ts` pass, including the 2 new blocks.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/validation.ts tests/validation.test.ts
git commit -m "feat: add GROWTH_TRACK/SERVICE_METRIC category types and countsTowardTotal field"
```

---

### Task 2: Category admin action pass-through and settings UI

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `tests/actions-categories.test.ts`

**Interfaces:**
- Consumes: `createCategorySchema` (Task 1) — now parses `countsTowardTotal`.
- Produces: no new exports. `createCategory` (`src/lib/actions/categories.ts`) needs **no code change** — it already does `const data = createCategorySchema.parse(input); await prisma.category.create({ data })`, so the new field flows through automatically once the schema (Task 1) includes it.

- [ ] **Step 1: Update the existing `createCategory` test expectation**

In `tests/actions-categories.test.ts`, the test `'creates the category for valid admin input'` currently asserts:

```ts
expect(categoryCreate).toHaveBeenCalledWith({
  data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null },
})
```

Update it to include the new default field:

```ts
expect(categoryCreate).toHaveBeenCalledWith({
  data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: true },
})
```

- [ ] **Step 2: Add a test for an explicit `countsTowardTotal: false`**

Add to the same `describe('createCategory', ...)` block:

```ts
it('passes an explicit countsTowardTotal: false through to the create call', async () => {
  requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
  categoryCreate.mockResolvedValue({ id: '2' })
  await createCategory({ name: 'Salvations', type: 'SERVICE_METRIC', countsTowardTotal: false })
  expect(categoryCreate).toHaveBeenCalledWith({
    data: { name: 'Salvations', type: 'SERVICE_METRIC', svgKey: null, countsTowardTotal: false },
  })
})
```

- [ ] **Step 3: Run the category action tests**

```bash
npm test -- actions-categories
```

Expected: all pass, including the updated and new assertions.

- [ ] **Step 4: Update the settings page form**

In `src/app/settings/page.tsx`, the "Add a category" form's `<select name="type">` currently has 3 options. Replace it with all 5:

```tsx
<select name="type" required style={{ padding: 'var(--space-3)' }}>
  <option value="SECTION">Sanctuary section</option>
  <option value="CLASSROOM">Classroom</option>
  <option value="GROWTH_TRACK">Growth Track</option>
  <option value="SERVE_TEAM">Serve team</option>
  <option value="SERVICE_METRIC">Ministry metric</option>
</select>
```

Add a checkbox right after it, before the submit button:

```tsx
<label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
  <input type="checkbox" name="countsTowardTotal" defaultChecked />
  Counts toward Total Attendance
</label>
```

Update the form's server action to read the checkbox (an unchecked HTML checkbox sends no field at all, so absence means `false`):

```tsx
action={async (formData: FormData) => {
  'use server'
  await createCategory({
    name: formData.get('name'),
    type: formData.get('type'),
    svgKey: (formData.get('svgKey') as string) || null,
    countsTowardTotal: formData.get('countsTowardTotal') === 'on',
  })
}}
```

- [ ] **Step 5: Manually verify the form in the browser**

Start the dev server, sign in as admin, go to `/settings`, and confirm: the type dropdown shows all 5 options, the checkbox is checked by default, and submitting with it unchecked creates a category with `countsTowardTotal: false` (spot-check via `npx prisma studio` or a quick `SELECT` if you want to confirm at the DB level).

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx tests/actions-categories.test.ts
git commit -m "feat: add countsTowardTotal toggle and new category types to settings form"
```

---

### Task 3: Type-aware total calculation

**Files:**
- Modify: `src/lib/actions/attendance.ts`
- Modify: `tests/actions-attendance.test.ts`

**Interfaces:**
- Consumes: `Category.countsTowardTotal` (Task 1).
- Produces: `getEventSummary()`'s return shape changes — `totals` gains a `growthTrack` key, and `totals.grand` now excludes any category with `countsTowardTotal: false`. `totals` becomes `{ sanctuary: number, classrooms: number, growthTrack: number, serveTeams: number, grand: number }`.

- [ ] **Step 1: Update the existing `getEventSummary` test fixture and expectation**

In `tests/actions-attendance.test.ts`, update `baseEvent` inside `describe('getEventSummary', ...)` to include `countsTowardTotal` on each category, and add a third record for a `SERVICE_METRIC` category that must NOT count toward the grand total:

```ts
const baseEvent = {
  id: 'e1',
  name: 'Sunday Service',
  serviceDate: '2026-08-09',
  records: [
    {
      categoryId: 'c1',
      count: 100,
      recordedBy: 'vol@example.com',
      updatedAt: new Date('2026-08-09T10:00:00Z'),
      category: { name: 'Main Hall', type: 'SECTION', sortOrder: 0, countsTowardTotal: true },
    },
    {
      categoryId: 'c2',
      count: 20,
      recordedBy: 'vol2@example.com',
      updatedAt: new Date('2026-08-09T10:05:00Z'),
      category: { name: 'Kids Room', type: 'CLASSROOM', sortOrder: 1, countsTowardTotal: true },
    },
    {
      categoryId: 'c3',
      count: 5,
      recordedBy: 'vol@example.com',
      updatedAt: new Date('2026-08-09T10:10:00Z'),
      category: { name: 'Salvations', type: 'SERVICE_METRIC', sortOrder: 2, countsTowardTotal: false },
    },
  ],
}
```

Replace the test `'computes totals by category type and a grand total'` with:

```ts
it('computes totals by category type and a grand total that excludes categories with countsTowardTotal: false', async () => {
  requireUser.mockResolvedValue(ADMIN)
  eventFindUnique.mockResolvedValue(baseEvent)
  const result = await getEventSummary('e1')
  expect(result.totals).toEqual({
    sanctuary: 100,
    classrooms: 20,
    growthTrack: 0,
    serveTeams: 0,
    // 120, not 125 — the Salvations record (a ministry metric) is excluded.
    grand: 120,
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- actions-attendance
```

Expected: FAIL — `result.totals` is missing `growthTrack` and `grand` is `125` (current code sums every record regardless of type).

- [ ] **Step 3: Update `getEventSummary`**

In `src/lib/actions/attendance.ts`, replace the return statement's totals construction:

```ts
const totalBy = (type: string) =>
  rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.count, 0)

// Grand total only includes categories marked as real headcounts — a
// ministry metric like Salvations must never inflate attendance.
const grand = event.records
  .filter((record) => record.category.countsTowardTotal)
  .reduce((sum, record) => sum + record.count, 0)

return {
  event: { id: event.id, name: event.name, serviceDate: event.serviceDate },
  rows,
  totals: {
    sanctuary: totalBy('SECTION'),
    classrooms: totalBy('CLASSROOM'),
    growthTrack: totalBy('GROWTH_TRACK'),
    serveTeams: totalBy('SERVE_TEAM'),
    grand,
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- actions-attendance
```

Expected: PASS, all tests in the file including the updated one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/attendance.ts tests/actions-attendance.test.ts
git commit -m "fix: exclude non-headcount categories from the Total Attendance calculation"
```

---

### Task 4: Report page — new groups and totals row

**Files:**
- Modify: `src/app/report/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `getEventSummary()`'s updated `totals` shape (Task 3).

- [ ] **Step 1: Update `TYPE_LABELS` and the group iteration**

In `src/app/report/[eventId]/page.tsx`, change:

```ts
const TYPE_LABELS: Record<string, string> = {
  SECTION: 'Sanctuary',
  CLASSROOM: 'Classrooms',
  SERVE_TEAM: 'Serve Teams',
}
```

to:

```ts
const TYPE_LABELS: Record<string, string> = {
  SECTION: 'Sanctuary',
  CLASSROOM: 'Classrooms',
  GROWTH_TRACK: 'Growth Track',
  SERVE_TEAM: 'Serve Teams',
  SERVICE_METRIC: 'Ministry Metrics',
}
```

and change the group iteration array:

```tsx
{(['SECTION', 'CLASSROOM', 'SERVE_TEAM'] as const).map((type) => {
```

to:

```tsx
{(['SECTION', 'CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC'] as const).map((type) => {
```

- [ ] **Step 2: Add the Growth Track row to the totals table**

In the same file, the hard-coded totals `<table>` currently has 3 rows plus the grand total. Add a Growth Track row between Classrooms and Serve Teams:

```tsx
<tr><td>Sanctuary</td><td style={{ textAlign: 'right' }}>{totals.sanctuary}</td></tr>
<tr><td>Classrooms</td><td style={{ textAlign: 'right' }}>{totals.classrooms}</td></tr>
<tr><td>Growth Track</td><td style={{ textAlign: 'right' }}>{totals.growthTrack}</td></tr>
<tr><td>Serve Teams</td><td style={{ textAlign: 'right' }}>{totals.serveTeams}</td></tr>
<tr style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
  <td>Total</td><td style={{ textAlign: 'right' }}>{totals.grand}</td>
</tr>
```

Note: Ministry Metrics deliberately has no row in this totals table — its individual values are already visible in its own group section above (from Step 1), and per the spec it must not contribute to Total Attendance.

- [ ] **Step 3: Manually verify**

Start the dev server, open `/report/<eventId>` for a service with data in every group, and confirm: 5 group tables render (Sanctuary, Classrooms, Growth Track, Serve Teams, Ministry Metrics), and the totals table shows 4 category rows + Total, with the Total excluding Ministry Metrics values.

- [ ] **Step 4: Commit**

```bash
git add "src/app/report/[eventId]/page.tsx"
git commit -m "feat: show Growth Track and Ministry Metrics groups on the report page"
```

---

### Task 5: Sanctuary map geometry — remove retired regions

**Files:**
- Modify: `src/lib/map-regions.ts`
- Modify: `tests/map-regions.test.ts`

**Interfaces:**
- Produces: `MAP_REGIONS` now has exactly 5 entries: `stage`, `left-wing`, `center-left`, `center-right`, `right-wing`. The `nursery`, `kids-older`, `kids-middle`, and `balcony` regions are removed (those rooms are no longer tied to a fixed spot on the map — Classrooms and Growth Track render as their own card grids instead, per Task 7).

- [ ] **Step 1: Update `MAP_REGIONS`**

Replace the array in `src/lib/map-regions.ts`:

```ts
export const MAP_REGIONS = [
  { key: 'stage', label: 'Stage', x: 180, y: 20, width: 240, height: 50 },
  { key: 'left-wing', label: 'Left Wing', x: 20, y: 100, width: 130, height: 300 },
  { key: 'center-left', label: 'Center Left', x: 165, y: 100, width: 130, height: 300 },
  { key: 'center-right', label: 'Center Right', x: 310, y: 100, width: 130, height: 300 },
  { key: 'right-wing', label: 'Right Wing', x: 455, y: 100, width: 125, height: 300 },
] as const
```

The section rects grow from `height: 220` to `height: 300` to fill the space the removed regions (`balcony`, `nursery`, `kids-older`, `kids-middle`) used to occupy — the viewBox stays `0 0 600 420` unchanged (sections now run from y=100 to y=400, a 20px margin to the bottom edge, matching the 20px margin above the stage).

- [ ] **Step 2: Add a test that locks in the finalized region set**

Add to `tests/map-regions.test.ts`, inside `describe('MAP_REGIONS', ...)`:

```ts
it('has exactly the 5 regions the sanctuary map design calls for, in map order', () => {
  expect(MAP_REGIONS.map((region) => region.key)).toEqual([
    'stage',
    'left-wing',
    'center-left',
    'center-right',
    'right-wing',
  ])
})
```

(The existing generic assertions in the file — unique keys, non-negative geometry, in-bounds geometry — already re-run against the new array unchanged and don't need editing.)

- [ ] **Step 3: Run the test**

```bash
npm test -- map-regions
```

Expected: PASS, all tests including the new one.

- [ ] **Step 4: Commit**

```bash
git add src/lib/map-regions.ts tests/map-regions.test.ts
git commit -m "feat: remove retired map regions, expand sanctuary sections to fill the space"
```

---

### Task 6: New `CategoryCard` component and `CategoryRow` dashed variant

**Files:**
- Create: `src/components/CategoryCard.tsx`
- Modify: `src/components/CategoryRow.tsx`

**Interfaces:**
- Produces: `CategoryCard({ name, count, onSelect })` — a grid tap-target matching the Classrooms/Growth Track card style from the approved mockup. `CategoryRow({ name, count, onSelect, dashed })` — `dashed` is a new optional prop (default `false`) that renders a dashed border for the Ministry Metrics group.
- Consumes: nothing new — same prop shapes already used by `EntryClient` (Task 7 wires these in).

Note: this codebase's Vitest config runs in a Node environment with no DOM (see `vitest.config.ts` — `environment: 'node'`, no jsdom dependency installed), and the existing `CounterDialog` component has no render-level tests for this reason — only its exported pure helper functions (`draftKeyFor`, `resolveInitialCount`) are tested. Follow the same convention here: no new test file for these two components: they're verified visually in Task 7's manual check instead.

- [ ] **Step 1: Create `CategoryCard.tsx`**

```tsx
'use client'

export function CategoryCard({
  name,
  count,
  onSelect,
}: {
  name: string
  count: number | undefined
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-label={`${name}, count ${count ?? 0}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-1)', padding: 'var(--space-3)', textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)' }}>{name}</span>
      <span style={{ fontWeight: 800, fontSize: 'var(--text-xl)', color: 'var(--color-accent)' }}>
        {count ?? '—'}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Add the `dashed` prop to `CategoryRow.tsx`**

Change the props type and the `style` object:

```tsx
'use client'

export function CategoryRow({
  name,
  count,
  onSelect,
  dashed = false,
}: {
  name: string
  count: number | undefined
  onSelect: () => void
  dashed?: boolean
}) {
  return (
    <button
      onClick={onSelect}
      aria-label={`${name}, count ${count ?? 0}`}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        width: '100%', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-2)',
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
    >
      <span>{name}</span>
      <span style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: 'var(--text-lg)' }}>
        {count ?? '—'}
      </span>
    </button>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors (these components aren't wired into any page yet — that's Task 7 — so this just confirms both files are syntactically and structurally valid on their own).

- [ ] **Step 4: Commit**

```bash
git add src/components/CategoryCard.tsx src/components/CategoryRow.tsx
git commit -m "feat: add CategoryCard component and dashed variant for CategoryRow"
```

---

### Task 7: Restructure the entry screen into grouped sections

**Files:**
- Modify: `src/app/entry/[eventId]/EntryClient.tsx`

**Interfaces:**
- Consumes: `CategoryCard` and `CategoryRow`'s `dashed` prop (Task 6). `Category.type` now includes `GROWTH_TRACK` and `SERVICE_METRIC` (Task 1) — categories of these types arrive in the `categories` prop once Task 8's seed data exists.
- Produces: no new exports — `EntryClient`'s external props (`eventId`, `categories`, `initialCounts`) are unchanged, so `src/app/entry/[eventId]/page.tsx` needs no edit.

- [ ] **Step 1: Replace `EntryClient.tsx`'s body**

The current file renders the sanctuary map, then dumps every category without an `svgKey` into one `<h2>Serve Teams & Other</h2>` list. Replace the whole file with:

```tsx
'use client'

import { useState } from 'react'
import { SanctuaryMap } from '@/components/SanctuaryMap'
import { CounterDialog } from '@/components/CounterDialog'
import { CategoryRow } from '@/components/CategoryRow'
import { CategoryCard } from '@/components/CategoryCard'

type Category = { id: string; name: string; type: string; svgKey: string | null }

const GROUP_ORDER = ['CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC'] as const

const GROUP_META: Record<(typeof GROUP_ORDER)[number], { heading: string; layout: 'grid' | 'list'; dashed?: boolean; subtitle?: string }> = {
  CLASSROOM: { heading: 'Classrooms', layout: 'grid' },
  GROWTH_TRACK: { heading: 'Growth Track', layout: 'grid' },
  SERVE_TEAM: { heading: 'SERVE Team', layout: 'list' },
  SERVICE_METRIC: {
    heading: 'Ministry Metrics',
    layout: 'list',
    dashed: true,
    subtitle: 'Not counted in attendance',
  },
}

export function EntryClient({
  eventId,
  categories,
  initialCounts,
}: {
  eventId: string
  categories: Category[]
  initialCounts: Record<string, number>
}) {
  const [counts, setCounts] = useState(initialCounts)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sanctuaryOnMap = categories.filter(
    (c): c is Category & { svgKey: string } => c.type === 'SECTION' && Boolean(c.svgKey)
  )
  // Sanctuary categories with no map position — e.g. Out of Service Total —
  // render as list rows under the same "Sanctuary" heading as the map.
  const sanctuaryListItems = categories.filter((c) => c.type === 'SECTION' && !c.svgKey)

  const groups = GROUP_ORDER.map((type) => ({
    type,
    meta: GROUP_META[type],
    items: categories.filter((c) => c.type === type),
  })).filter((group) => group.items.length > 0)

  const selected = categories.find((c) => c.id === selectedId)

  return (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)' }}>Sanctuary</h2>
      <SanctuaryMap categories={sanctuaryOnMap} counts={counts} onSelect={setSelectedId} />
      {sanctuaryListItems.map((category) => (
        <CategoryRow
          key={category.id}
          name={category.name}
          count={counts[category.id]}
          onSelect={() => setSelectedId(category.id)}
        />
      ))}

      {groups.map(({ type, meta, items }) => (
        <div key={type}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-8)' }}>
            {meta.heading}
            {meta.subtitle && (
              <span style={{ fontWeight: 400, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                {' '}({meta.subtitle})
              </span>
            )}
          </h2>
          {meta.layout === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              {items.map((category) => (
                <CategoryCard
                  key={category.id}
                  name={category.name}
                  count={counts[category.id]}
                  onSelect={() => setSelectedId(category.id)}
                />
              ))}
            </div>
          ) : (
            items.map((category) => (
              <CategoryRow
                key={category.id}
                name={category.name}
                count={counts[category.id]}
                onSelect={() => setSelectedId(category.id)}
                dashed={meta.dashed}
              />
            ))
          )}
        </div>
      ))}

      {selected && (
        <CounterDialog
          eventId={eventId}
          categoryId={selected.id}
          categoryName={selected.name}
          initialCount={counts[selected.id] ?? 0}
          onClose={() => setSelectedId(null)}
          onSaved={(count) => setCounts((prev) => ({ ...prev, [selected.id]: count }))}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manually verify in the browser**

This can't be meaningfully checked until Task 8's seed data exists (otherwise there are no `GROWTH_TRACK`/`SERVICE_METRIC` categories to render) — do this check after Task 8, not before. At that point: start the dev server, sign in, open an entry screen, and confirm 5 headings render in order (Sanctuary, Classrooms, Growth Track, SERVE Team, Ministry Metrics), Classrooms/Growth Track render as 3-column card grids, SERVE Team/Ministry Metrics render as list rows, Ministry Metrics rows have a dashed border and the "(Not counted in attendance)" subtitle, and tapping any item still opens `CounterDialog` and saves correctly.

- [ ] **Step 4: Commit**

```bash
git add "src/app/entry/[eventId]/EntryClient.tsx"
git commit -m "feat: group entry-screen categories by type with dedicated headings and layouts"
```

---

### Task 8: Seed script — retire old categories, add the real list

**Files:**
- Modify: `prisma/seed.ts`
- Create: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `CategoryType` (Task 1), `countsTowardTotal` (Task 1).
- Produces: `seedCategories()` — a new export from `prisma/seed.ts`, callable independently of `main()` (which still handles the Allowlist admin row and process exit codes). After running, the `Category` table matches the spec's final list exactly, with the 6 retired categories set `isActive: false`.

Note: the current `prisma/seed.ts` calls `main()` unconditionally at module load, which makes it untestable as-is — importing the file for a test would trigger a real seed run as a side effect of the import itself. This task refactors it to export the category-seeding logic as a plain async function and guards the auto-run behind an entry-point check, so `tests/seed.test.ts` can call `seedCategories()` directly.

- [ ] **Step 1: Replace `prisma/seed.ts`**

```ts
import { PrismaClient, CategoryType } from '@prisma/client'

const prisma = new PrismaClient()

export const DEFAULT_CATEGORIES: Array<{
  name: string
  type: CategoryType
  svgKey: string | null
  countsTowardTotal?: boolean
}> = [
  { name: 'Left Wing', type: CategoryType.SECTION, svgKey: 'left-wing' },
  { name: 'Center Left', type: CategoryType.SECTION, svgKey: 'center-left' },
  { name: 'Center Right', type: CategoryType.SECTION, svgKey: 'center-right' },
  { name: 'Right Wing', type: CategoryType.SECTION, svgKey: 'right-wing' },
  { name: 'Out of Service Total', type: CategoryType.SECTION, svgKey: null },
  { name: '0-2', type: CategoryType.CLASSROOM, svgKey: null },
  { name: '3-5', type: CategoryType.CLASSROOM, svgKey: null },
  { name: '6-11', type: CategoryType.CLASSROOM, svgKey: null },
  { name: 'First Step', type: CategoryType.GROWTH_TRACK, svgKey: null },
  { name: 'Next Step', type: CategoryType.GROWTH_TRACK, svgKey: null },
  { name: 'Leadership Step', type: CategoryType.GROWTH_TRACK, svgKey: null },
  { name: 'Parking', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Hospitality', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Welcome', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Mana Kids', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Host', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Production', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Worship', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Guardians', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Salvations', type: CategoryType.SERVICE_METRIC, svgKey: null, countsTowardTotal: false },
  { name: 'Connection Cards Given', type: CategoryType.SERVICE_METRIC, svgKey: null, countsTowardTotal: false },
  { name: 'Connection Cards Returned', type: CategoryType.SERVICE_METRIC, svgKey: null, countsTowardTotal: false },
  { name: 'Welcome Packs Given', type: CategoryType.SERVICE_METRIC, svgKey: null, countsTowardTotal: false },
]

/** No longer on the real paper sheet. Soft-deleted, never removed outright — see Task 12 of the original plan's ledger for why categories are never hard-deleted. */
export const RETIRED_CATEGORIES: Array<{ name: string; type: CategoryType }> = [
  { name: 'Balcony', type: CategoryType.SECTION },
  { name: 'Nursery', type: CategoryType.CLASSROOM },
  { name: "Older Children's Classroom", type: CategoryType.CLASSROOM },
  { name: 'Middle Age Classroom', type: CategoryType.CLASSROOM },
  { name: 'Coffee', type: CategoryType.SERVE_TEAM },
  { name: 'Kids Center', type: CategoryType.SERVE_TEAM },
]

/**
 * Retires categories no longer on the paper sheet, then upserts the current
 * list. Exported separately from `main` so it can be called directly from a
 * test without also touching the Allowlist table or the process exit code.
 */
export async function seedCategories() {
  for (const retired of RETIRED_CATEGORIES) {
    await prisma.category.updateMany({
      where: { name: retired.name, type: retired.type },
      data: { isActive: false },
    })
  }

  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: { isActive: true },
      create: { ...category, sortOrder: index },
    })
  }
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  if (!adminEmail) {
    throw new Error('SEED_ADMIN_EMAIL is required — without it nobody can sign in.')
  }

  await prisma.allowlist.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN', isActive: true },
    create: { email: adminEmail, role: 'ADMIN', isActive: true },
  })
  console.log(`Seeded admin: ${adminEmail}`)

  await seedCategories()
  console.log(`Retired ${RETIRED_CATEGORIES.length} categories no longer on the paper sheet`)
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} categories`)
}

// Only auto-run when executed directly (`npm run db:seed` / `prisma db seed`),
// never when another module imports this file — e.g. tests/seed.test.ts
// importing `seedCategories` must not trigger a full seed run as a side effect.
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error)
      await prisma.$disconnect()
      process.exit(1)
    })
}
```

- [ ] **Step 2: Run the seed script**

```bash
cd ~/projects/church-attendance/church-attendance-app
npm run db:seed
```

Expected: prints `Seeded admin: ...`, `Retired 6 categories no longer on the paper sheet`, `Seeded 23 categories`, no errors.

- [ ] **Step 3: Verify the result in the database**

```bash
npx tsx -r dotenv/config prisma/_verify_seed.ts
```

Since there's no existing script for this, instead just spot-check directly — run this one-off from the repo root (it isn't a permanent file, delete it after):

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });
const prisma = new PrismaClient();
(async () => {
  const active = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] });
  const retired = await prisma.category.findMany({ where: { isActive: false } });
  console.log('Active:', active.length, '- Retired:', retired.length);
  console.log(active.map(c => \`\${c.type}: \${c.name} (counts=\${c.countsTowardTotal})\`).join('\n'));
  await prisma.\$disconnect();
})();
"
```

Expected: 23 active categories matching the table in the spec exactly, and the 6 retired names show up with `isActive: false` if you separately query `{ isActive: false }`.

- [ ] **Step 4: Write `tests/seed.test.ts`**

Follows the live-database pattern already used by `tests/prisma-schema.test.ts` (real Neon DB, skipped automatically when `DATABASE_URL` isn't set — which is the case in CI's `npm test` step):

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { seedCategories, DEFAULT_CATEGORIES } from '../prisma/seed'

const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('seedCategories (live database)', () => {
  it('retires a category that is on the retired list, even if it was re-activated', async () => {
    // Force Balcony active first, so the assertion below actually proves
    // seedCategories() is what turned it off — not that it was already off.
    await prisma.category.upsert({
      where: { name_type: { name: 'Balcony', type: 'SECTION' } },
      update: { isActive: true },
      create: { name: 'Balcony', type: 'SECTION', sortOrder: 999, isActive: true },
    })

    await seedCategories()

    const balcony = await prisma.category.findUniqueOrThrow({
      where: { name_type: { name: 'Balcony', type: 'SECTION' } },
    })
    expect(balcony.isActive).toBe(false)
  })

  it('creates every category in DEFAULT_CATEGORIES as active', async () => {
    await seedCategories()

    const activeCount = await prisma.category.count({
      where: { name: { in: DEFAULT_CATEGORIES.map((c) => c.name) }, isActive: true },
    })
    expect(activeCount).toBe(DEFAULT_CATEGORIES.length)
  })

  it('sets countsTowardTotal correctly for a headcount category vs. a ministry metric', async () => {
    await seedCategories()

    const section = await prisma.category.findUniqueOrThrow({
      where: { name_type: { name: 'Left Wing', type: 'SECTION' } },
    })
    const metric = await prisma.category.findUniqueOrThrow({
      where: { name_type: { name: 'Salvations', type: 'SERVICE_METRIC' } },
    })
    expect(section.countsTowardTotal).toBe(true)
    expect(metric.countsTowardTotal).toBe(false)
  })
})
```

No `afterAll` cleanup deletes these rows — unlike `prisma-schema.test.ts`'s scoped throwaway fixtures, `DEFAULT_CATEGORIES` and `Balcony` are the app's real, permanent seed data; the assertions above converge the DB to the same correct end state the manual seed run in Step 2 already produced, so re-running this test is safe and idempotent.

- [ ] **Step 5: Run the new tests**

```bash
npm test -- seed
```

Expected: PASS (requires `DATABASE_URL` to be set from `.env.local`, same as the other live-DB suites — confirm `tests/setup.ts` is still loading it, per the existing project convention).

- [ ] **Step 6: Manually verify the entry screen now (revisit Task 7's Step 3)**

Now that real `GROWTH_TRACK`/`SERVICE_METRIC` categories exist, load `/entry/<eventId>` in the browser and confirm the full grouped layout from Task 7 renders correctly end-to-end with real data.

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts tests/seed.test.ts
git commit -m "feat: rewrite seed data to match the real attendance sheet's categories"
```

---

### Task 9: Accessible color token system (light default, dark media query)

**Files:**
- Modify: `src/styles/tokens.css`

**Interfaces:**
- Produces: all `--color-*` tokens get new values; `--text-*` tokens increase; new token `--text-3xl` is added (consumed by Task 10).

- [ ] **Step 1: Replace `tokens.css`**

```css
:root {
  --color-bg: #F7F8FA;
  --color-surface: #FFFFFF;
  --color-surface-raised: #F0F2F5;
  --color-border: #D5D9E0;
  --color-text: #14161A;
  --color-text-muted: #4A505C;
  --color-accent: #0072B2;
  --color-accent-contrast: #FFFFFF;
  --color-danger: #D55E00;
  --color-success: #009E73;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --text-sm: 1rem;
  --text-base: 1.125rem;
  --text-lg: 1.375rem;
  --text-xl: 2rem;
  --text-2xl: 2.75rem;
  --text-3xl: 3.5rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  --radius: 12px;
  --radius-lg: 20px;
  --shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  --transition: 160ms cubic-bezier(0.2, 0.8, 0.2, 1);

  /* Minimum accessible touch target — volunteers use phones in dim rooms. */
  --tap-target: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0F1115;
    --color-surface: #181B22;
    --color-surface-raised: #21252E;
    --color-border: #3A4150;
    --color-text: #F5F7FA;
    --color-text-muted: #B8C0CC;
    --color-accent: #56B4E9;
    --color-accent-contrast: #05121C;
    --color-danger: #FF8A3D;
    --color-success: #33D6A6;
    --shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }
}
```

This is a colorblind-safe palette (Okabe–Ito) replacing the old single gold accent and red/green danger/success pair. `--text-*` values are all one step larger than before; `--text-3xl` is new (used only by Task 10's counter digit).

- [ ] **Step 2: Verify contrast ratios**

Run this one-off Node check from the repo root (uses no new dependency — plain relative-luminance math):

```bash
node -e "
function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const pairs = [
  ['light text/bg', '#14161A', '#F7F8FA'],
  ['light muted/bg', '#4A505C', '#F7F8FA'],
  ['light accent/bg', '#0072B2', '#F7F8FA'],
  ['dark text/bg', '#F5F7FA', '#0F1115'],
  ['dark muted/bg', '#B8C0CC', '#0F1115'],
  ['dark accent/bg', '#56B4E9', '#0F1115'],
];
for (const [label, a, b] of pairs) console.log(label, contrast(a, b).toFixed(2));
"
```

Expected: every ratio at or above 4.5 (body text) or 3.0 (large text/UI — accent pairs only need to clear this lower bar since they're always paired with bold/large weight in this app). If any pair fails, darken/lighten that specific token by a few percent and re-run before moving on — do not proceed with a failing ratio.

- [ ] **Step 3: Manually verify in the browser**

Start the dev server, load any page, and toggle your OS/browser dark mode — confirm the palette switches without a page reload being required (CSS media query, not JS), and spot-check text legibility in both modes.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat: replace color/type tokens with a colorblind-safe, higher-contrast, light/dark palette"
```

---

### Task 10: CounterDialog — bigger counter digit, icon-paired error state

**Files:**
- Modify: `src/components/CounterDialog.tsx`

**Interfaces:**
- Consumes: `--text-3xl` (Task 9).

- [ ] **Step 1: Use the new size token for the counter digit**

In `src/components/CounterDialog.tsx`, change:

```tsx
<output style={{ fontSize: '3rem', fontWeight: 700, minWidth: '4rem' }} aria-live="polite">{count}</output>
```

to:

```tsx
<output style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, minWidth: '4rem' }} aria-live="polite">{count}</output>
```

- [ ] **Step 2: Pair the error message with an icon, not color alone**

Change:

```tsx
{status === 'error' && (
  <p role="alert" style={{ color: 'var(--color-danger)' }}>
    Could not save — your count is still here. Check your signal and tap Save again.
  </p>
)}
```

to:

```tsx
{status === 'error' && (
  <p
    role="alert"
    style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
  >
    <span aria-hidden="true">⚠</span>
    Could not save — your count is still here. Check your signal and tap Save again.
  </p>
)}
```

- [ ] **Step 3: Run the component's existing tests**

```bash
npm test -- counter-dialog-draft
```

Expected: PASS — this test file only exercises the exported `draftKeyFor`/`resolveInitialCount` helpers, neither of which this task touches, so it should be unaffected.

- [ ] **Step 4: Manually verify in the browser**

Open a counter dialog, confirm the digit is visibly larger, then simulate a save failure (e.g. temporarily stop the dev server mid-save, or throttle network in devtools to force a timeout) and confirm the ⚠ icon appears alongside the red error text, not just the color change.

- [ ] **Step 5: Commit**

```bash
git add src/components/CounterDialog.tsx
git commit -m "feat: enlarge the counter digit and pair the error state with an icon"
```

---

### Task 11: Full manual verification pass

**Files:** none — this task is verification only, no code changes.

- [ ] **Step 1: Re-run the three checks from the 2026-08-16 testing session**

With the dev server running and signed in:
1. **Persistence + draft recovery** (originally Task 11 of the deploy plan): bump a count in any group, Save, reload — confirm it persisted. Bump again without saving, reload — confirm the draft is recovered.
2. **Authorization boundary** (originally Task 12): sign in as a VOLUNTEER-role account, navigate directly to `/settings` — confirm it's blocked (throws/redirects), not rendered.
3. **Print preview** (originally Task 13): open `/report/<eventId>`, Ctrl+P — confirm white background, no visible buttons, and no group split across a page break. With 5 groups now instead of 3, double-check specifically that this still holds — more content means more chance of an awkward break.

- [ ] **Step 2: Verify the new behavior specifically**

1. Confirm `/entry/<eventId>` shows 5 headings in the right order (Sanctuary, Classrooms, Growth Track, SERVE Team, Ministry Metrics) with the right layout each (map + list, grid, grid, list, dashed list).
2. Confirm the report's Total Attendance number matches "everything except the 4 Ministry Metrics values" — pick a service, add a Salvations count, and verify the Total on `/report/<eventId>` does NOT change when you do.
3. Toggle OS dark mode and confirm both the entry screen and report page follow it.

- [ ] **Step 3: Run the full test suite one more time**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all green — no regressions from the full sequence of changes across Tasks 1–10.
