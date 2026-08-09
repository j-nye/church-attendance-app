import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export type Role = 'ADMIN' | 'VOLUNTEER'
export type CurrentUser = { email: string; role: Role }

export class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code === 'UNAUTHENTICATED' ? 'Not signed in' : 'Not authorized')
    this.name = 'AuthzError'
  }
}

/**
 * Assert the caller is signed in AND currently on the allowlist.
 *
 * The allowlist row is re-read on every call rather than trusted from the JWT,
 * so deactivating someone revokes their access on their very next request
 * instead of whenever their token happens to expire.
 *
 * Call this as the FIRST statement of every Server Action.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) throw new AuthzError('UNAUTHENTICATED')

  const entry = await prisma.allowlist.findUnique({ where: { email } })
  if (!entry || !entry.isActive) throw new AuthzError('FORBIDDEN')

  return { email: entry.email, role: entry.role as Role }
}

/** Assert the caller is an active ADMIN. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser()
  if (user.role !== 'ADMIN') throw new AuthzError('FORBIDDEN')
  return user
}
