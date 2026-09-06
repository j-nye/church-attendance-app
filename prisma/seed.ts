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
