import { Prisma } from '@prisma/client'

/**
 * True when `error` is a Prisma unique-constraint violation (P2002).
 *
 * Lives outside any 'use server' file on purpose: Next.js requires every
 * export from a 'use server' module to be an async Server Action, and this
 * is a plain synchronous type guard shared by multiple action files.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
