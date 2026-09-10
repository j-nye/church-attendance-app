import { prisma } from '@/lib/prisma'

/**
 * Batch-resolve recordedBy emails to display names.
 *
 * Deliberately a plain module, NOT an export of a 'use server' file: Next.js 16
 * requires every export of such a file to be an async Server Action, and a
 * synchronous-shaped helper exported from one breaks the build in a way that
 * neither lint, tsc, the test suite, nor `next build` catches — only Turbopack's
 * dev import graph does. Same reason src/lib/prisma-errors.ts exists.
 *
 * Returns `null` for an unknown email — it never echoes the email back. That
 * asymmetry is load-bearing: an email-shaped fallback here would travel
 * straight through a caller's unconditional display field and put a raw
 * address in front of every volunteer, silently defeating the admin-only
 * rule on emails. Callers decide what an unknown name looks like for *their*
 * audience; this function never decides it for them.
 *
 * Prefers `adminOverrideName` over `name` when both are set.
 */
export async function resolveDisplayNames(
  emails: Iterable<string>,
): Promise<Map<string, string | null>> {
  const distinctEmails = Array.from(new Set(emails))
  if (distinctEmails.length === 0) return new Map()

  // recordedBy is always lowercased by requireUser, but an Allowlist row's
  // email is not guaranteed to be stored in that exact case, so match
  // case-insensitively rather than assume both sides already agree.
  const rows = await prisma.allowlist.findMany({
    where: {
      OR: distinctEmails.map((email) => ({
        email: { equals: email, mode: 'insensitive' as const },
      })),
    },
    select: { email: true, name: true, adminOverrideName: true },
  })

  const byLowerEmail = new Map<string, string | null>()
  for (const row of rows) {
    byLowerEmail.set(row.email.toLowerCase(), row.adminOverrideName ?? row.name ?? null)
  }

  const result = new Map<string, string | null>()
  for (const email of distinctEmails) {
    result.set(email, byLowerEmail.get(email.toLowerCase()) ?? null)
  }
  return result
}
