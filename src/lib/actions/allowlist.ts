'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, AuthzError } from '@/lib/authz'
import { allowlistEntrySchema, idSchema, friendlyValidationMessage } from '@/lib/validation'

export async function listAllowlist() {
  await requireAdmin()
  return prisma.allowlist.findMany({ orderBy: [{ isActive: 'desc' }, { email: 'asc' }] })
}

export async function addAllowlistEntry(input: unknown) {
  await requireAdmin()
  const { email, role } = allowlistEntrySchema.parse(input)

  await prisma.allowlist.upsert({
    where: { email },
    update: { role, isActive: true },
    create: { email, role, isActive: true },
  })
  revalidatePath('/settings')
}

/** Deactivating takes effect immediately — see requireUser() in src/lib/authz.ts. */
export async function deactivateAllowlistEntry(input: unknown) {
  const actor = await requireAdmin()
  const id = idSchema.parse(input)

  const target = await prisma.allowlist.findUnique({ where: { id } })
  if (!target) throw new Error('No such allowlist entry')

  if (target.email === actor.email) {
    throw new Error('You cannot remove your own access')
  }

  if (target.role === 'ADMIN' && target.isActive) {
    const activeAdmins = await prisma.allowlist.count({
      where: { role: 'ADMIN', isActive: true },
    })
    if (activeAdmins <= 1) {
      throw new Error('Cannot remove the last active admin — promote someone else first')
    }
  }

  await prisma.allowlist.update({ where: { id }, data: { isActive: false } })
  revalidatePath('/settings')
}

export type AllowlistFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around addAllowlistEntry() for the
 * settings page's "Who can sign in" form. Catches invalid input and a
 * stale/revoked admin session as an inline { ok: false, message } result.
 *
 * addAllowlistEntry() upserts on the unique email column, so re-adding an
 * existing address is a normal update (e.g. changing that person's role),
 * not a Prisma unique-constraint error — there is deliberately no P2002
 * branch here. addAllowlistEntry() itself keeps its existing throwing
 * contract unchanged — other callers and its own tests above depend on it.
 */
export async function addAllowlistEntryAction(
  _prevState: AllowlistFormState,
  formData: FormData
): Promise<AllowlistFormState> {
  try {
    await addAllowlistEntry({ email: formData.get('email'), role: formData.get('role') })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    throw error
  }
  return { ok: true }
}
