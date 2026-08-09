import { PrismaClient, CategoryType } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_CATEGORIES: Array<{ name: string; type: CategoryType; svgKey: string | null }> = [
  { name: 'Center Left', type: CategoryType.SECTION, svgKey: 'center-left' },
  { name: 'Center Right', type: CategoryType.SECTION, svgKey: 'center-right' },
  { name: 'Left Wing', type: CategoryType.SECTION, svgKey: 'left-wing' },
  { name: 'Right Wing', type: CategoryType.SECTION, svgKey: 'right-wing' },
  { name: 'Balcony', type: CategoryType.SECTION, svgKey: 'balcony' },
  { name: 'Nursery', type: CategoryType.CLASSROOM, svgKey: 'nursery' },
  { name: "Older Children's Classroom", type: CategoryType.CLASSROOM, svgKey: 'kids-older' },
  { name: 'Middle Age Classroom', type: CategoryType.CLASSROOM, svgKey: 'kids-middle' },
  { name: 'Welcome', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Host', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Coffee', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Guardians', type: CategoryType.SERVE_TEAM, svgKey: null },
  { name: 'Kids Center', type: CategoryType.SERVE_TEAM, svgKey: null },
]

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

  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: {},
      create: { ...category, sortOrder: index },
    })
  }
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} categories`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
