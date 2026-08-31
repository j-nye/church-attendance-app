import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

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

/**
 * Page-level convenience wrapper around requireUser(): on AuthzError,
 * redirects to the existing /denied page server-side — before any client
 * component (and therefore any error boundary) ever mounts — instead of
 * leaving Next's raw (and in production, masked) error screen as the only
 * outcome. Any other exception (a real bug, a DB outage) is rethrown
 * untouched so the app's error.tsx boundary still catches it.
 *
 * This is convenience, not the security boundary — every Server Action
 * called from the page re-checks requireUser()/requireAdmin() independently
 * per AGENTS.md, exactly as before this helper existed.
 */
export async function requireUserPage(): Promise<CurrentUser> {
  try {
    return await requireUser()
  } catch (error) {
    if (error instanceof AuthzError) redirect('/denied')
    throw error
  }
}

/** Same as requireUserPage(), but for admin-only pages. */
export async function requireAdminPage(): Promise<CurrentUser> {
  try {
    return await requireAdmin()
  } catch (error) {
    if (error instanceof AuthzError) redirect('/denied')
    throw error
  }
}
