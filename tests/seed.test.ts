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
