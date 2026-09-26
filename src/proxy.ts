import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'

// Builds its own NextAuth instance from the Prisma-free authConfig rather than
// importing `auth` from '@/lib/auth' — that module also wires in the DB-backed
// signIn callback, which would pull the Prisma engine into this function's
// bundle even though the check below never touches the database.
const { auth } = NextAuth(authConfig)

/**
 * COSMETIC ONLY. This bounces signed-out visitors to /login so they do not see
 * a broken page. It is NOT a security boundary — every Server Action and page
 * enforces access itself via requireUser()/requireAdmin() in src/lib/authz.ts.
 */
export default auth((req) => {
  const isAuthed = Boolean(req.auth?.user?.email)
  const { pathname } = req.nextUrl
  const isPublic = pathname === '/login' || pathname === '/denied' || pathname === '/privacy' || pathname === '/terms'

  if (!isAuthed && !isPublic) {
    return Response.redirect(new URL('/login', req.nextUrl))
  }
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
