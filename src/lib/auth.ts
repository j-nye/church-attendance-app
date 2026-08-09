import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { prisma } from '@/lib/prisma'

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
    /** Gate 1: refuse to mint a session for anyone not on the allowlist. */
    async signIn({ profile }) {
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
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email.toLowerCase()
      if (profile?.sub) token.googleSub = profile.sub
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email
        session.user.googleSub = token.googleSub as string | undefined
      }
      return session
    },
  },
})
