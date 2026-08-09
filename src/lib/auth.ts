import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import type { Profile, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

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
  // so a later email change does not orphan the account.
  if (profile.sub && entry.googleSub !== profile.sub) {
    await prisma.allowlist.update({
      where: { email },
      data: { googleSub: profile.sub },
    })
  }

  return true
}

export async function jwtCallback({ token, profile }: { token: JWT; profile?: Profile }) {
  if (profile?.email) token.email = profile.email.toLowerCase()
  if (profile?.sub) token.googleSub = profile.sub
  return token
}

export async function sessionCallback({ session, token }: { session: Session; token: JWT }) {
  if (session.user) {
    session.user.email = (token.email as string) ?? session.user.email
    session.user.googleSub = token.googleSub as string | undefined
  }
  return session
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: {
    strategy: 'jwt',
    // Identity only. Authorization is re-read from the DB on every mutation,
    // so this TTL controls re-login frequency, not access revocation.
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: {
    signIn: '/login',
    error: '/denied',
  },
  callbacks: {
    signIn: signInCallback,
    jwt: jwtCallback,
    session: sessionCallback,
  },
})
