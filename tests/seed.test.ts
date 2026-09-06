import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { seedCategories, normalizeCategorySortOrder, DEFAULT_CATEGORIES } from '../prisma/seed'
import { isDatabaseReachable } from './db-probe'

// DATABASE_URL being set isn't enough to prove the suite can actually run —
// it might point at a database that's unreachable from this environment
// (Neon down, no outbound network, etc). Without this probe, the first query
// below would hang until Vitest's per-test timeout and every test would
// report as failed instead of skipped. The probe is a bare TCP connect
// capped at ~2s, so an unreachable DB skips quickly instead of cascading
// into a wall of 5s timeouts.
const hasDatabase =
  Boolean(process.env.DATABASE_URL) && (await isDatabaseReachable(process.env.DATABASE_URL!))

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

  it('corrects sortOrder on re-seed when a category already existed with a stale value', async () => {
    // Force Left Wing's sortOrder into a wrong state first, so the assertion
    // below actually proves seedCategories() is what fixed it — not that it
    // was already correct.
    await prisma.category.upsert({
      where: { name_type: { name: 'Left Wing', type: 'SECTION' } },
      update: { sortOrder: 999 },
      create: { name: 'Left Wing', type: 'SECTION', svgKey: 'left-wing', sortOrder: 999, isActive: true },
    })

    await seedCategories()

    const leftWing = await prisma.category.findUniqueOrThrow({
      where: { name_type: { name: 'Left Wing', type: 'SECTION' } },
    })
    const expectedIndex = DEFAULT_CATEGORIES.findIndex(
      (c) => c.name === 'Left Wing' && c.type === 'SECTION'
    )
    expect(leftWing.sortOrder).toBe(expectedIndex)
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
