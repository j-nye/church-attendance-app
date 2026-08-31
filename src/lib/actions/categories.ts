'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/authz'
import { AuthzError } from '@/lib/authz'
import { createCategorySchema, idSchema } from '@/lib/validation'
import { friendlyValidationMessage } from '@/lib/validation'

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

export type CategoryFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around createCategory() for the settings
 * page's "Add a category" form. Catches only EXPECTED failures — invalid
 * input, a duplicate name+type (the schema's @@unique([name, type])
 * constraint), or a stale/revoked admin session — and turns them into an
 * inline { ok: false, message } the form renders without a crash. Anything
 * else (a real bug, a DB outage) is rethrown so the app's error.tsx boundary
 * still catches it. createCategory() itself keeps its existing throwing
 * contract unchanged — other callers and its own tests above depend on it.
 */
export async function createCategoryAction(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  try {
    await createCategory({
      name: formData.get('name'),
      type: formData.get('type'),
      svgKey: (formData.get('svgKey') as string) || null,
      countsTowardTotal: formData.get('countsTowardTotal') === 'on',
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
