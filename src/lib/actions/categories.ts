'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/authz'
import { createCategorySchema, updateCategorySchema, idSchema } from '@/lib/validation'

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

export async function renameCategory(input: unknown) {
  await requireAdmin()
  const { id, name, sortOrder } = updateCategorySchema.parse(input)

  // Renaming rewrites how past reports read. Acceptable, but never silent —
  // the settings UI warns before calling this.
  await prisma.category.update({ where: { id }, data: { name, sortOrder } })
  revalidatePath('/settings')
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

export async function reactivateCategory(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.category.update({ where: { id }, data: { isActive: true } })
  revalidatePath('/settings')
}
