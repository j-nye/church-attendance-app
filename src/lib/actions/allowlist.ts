'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/authz'
import { allowlistEntrySchema, idSchema } from '@/lib/validation'

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
