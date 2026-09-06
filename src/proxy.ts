import { auth } from '@/lib/auth'

/**
 * COSMETIC ONLY. This bounces signed-out visitors to /login so they do not see
 * a broken page. It is NOT a security boundary — every Server Action and page
 * enforces access itself via requireUser()/requireAdmin() in src/lib/authz.ts.
 */
export default auth((req) => {
  const isAuthed = Boolean(req.auth?.user?.email)
  const { pathname } = req.nextUrl
  const isPublic = pathname === '/login' || pathname === '/denied'

  if (!isAuthed && !isPublic) {
    return Response.redirect(new URL('/login', req.nextUrl))
  }
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
