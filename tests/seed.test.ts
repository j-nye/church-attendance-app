import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { seedCategories, DEFAULT_CATEGORIES } from '../prisma/seed'
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
