import NextAuth from 'next-auth'
import type { Profile } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authConfig } from '@/lib/auth.config'

// Extracted (rather than defined inline in the NextAuth() call) so the allowlist
// gate — the actual security logic this module exists for — can be invoked
// directly in tests against the real database, without going through the full
// OAuth redirect flow.

/** Gate 1: refuse to mint a session for anyone not on the allowlist. */
export async function signInCallback({ profile }: { profile?: Profile }) {
  if (!profile?.email || profile.email_verified !== true) return false

  const email = profile.email.toLowerCase()
  const entry = await prisma.allowlist.findUnique({ where: { email } })
  if (!entry || !entry.isActive) return false

  // Bind the row to the stable Google subject on first successful sign-in,
  // so a later email change does not orphan the account. Also re-sync the
  // display name Google reports, on every sign-in, so a legitimate name
  // change (marriage, correction) propagates. `adminOverrideName` is never
  // touched here — it is an admin's manual correction, kept in its own
  // column precisely so this unconditional re-sync of `name` can never
  // clobber it. Both go through a single `update` call, issued only when
  // something actually changed.
  const data: { googleSub?: string; name?: string } = {}
  if (profile.sub && entry.googleSub !== profile.sub) {
    data.googleSub = profile.sub
  }
  if (profile.name && entry.name !== profile.name) {
    data.name = profile.name
  }
  if (Object.keys(data).length > 0) {
    await prisma.allowlist.update({ where: { email }, data })
  }

  return true
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    signIn: signInCallback,
  },
})
