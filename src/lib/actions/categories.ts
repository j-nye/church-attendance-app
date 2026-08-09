'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/authz'
import { createCategorySchema, idSchema } from '@/lib/validation'

export async function listActiveCategories() {
  await requireUser()
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })
}

export async function createCategory(input: unknown) {
  await requireAdmin()
  const data = createCategorySchema.parse(input)

  const category = await prisma.category.create({ data })
  revalidatePath('/settings')
  return category
}

/**
 * Soft delete. Hard deletion would destroy attendance history, and the
 * `onDelete: Restrict` relation blocks it at the database level anyway.
 */
export async function deactivateCategory(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.category.update({ where: { id }, data: { isActive: false } })
  revalidatePath('/settings')
}
