import Google from 'next-auth/providers/google'
import type { NextAuthConfig, Profile, Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

// No Prisma import in this file or anything it pulls in — src/proxy.ts builds
// its own NextAuth instance from this config so the auth gate it runs on
// every request doesn't bundle the Prisma engine. The DB-backed signIn gate
// lives in src/lib/auth.ts instead, which extends this config for actual use
// (API route handlers, server actions, pages).

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

export const authConfig = {
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
    jwt: jwtCallback,
    session: sessionCallback,
  },
} satisfies NextAuthConfig
