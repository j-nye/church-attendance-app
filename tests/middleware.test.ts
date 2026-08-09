import { describe, it, expect, vi } from 'vitest'

// middleware.ts calls `auth(handler)` from '@/lib/auth', where the real NextAuth
// `auth` wraps `handler` in session-loading machinery we don't want to exercise
// here. Mocking `auth` to just return its handler lets us call that inner
// handler directly with a fake NextRequest-shaped object, isolating the
// redirect-UX logic this file exists to test. This is the ONLY thing
// src/middleware.ts is meant to do — see the file's own docstring: it is not
// a security boundary, every Server Action re-checks via requireUser()/
// requireAdmin() against the database regardless of what happens here.
vi.mock('@/lib/auth', () => ({
  auth: (handler: unknown) => handler,
}))

function makeReq(pathname: string, authed: boolean) {
  return {
    auth: authed ? { user: { email: 'someone@example.com' } } : null,
    nextUrl: new URL(`http://localhost:3000${pathname}`),
  }
}

describe('middleware (redirect UX only, not a security boundary)', () => {
  it('redirects an unauthenticated visitor from a protected path to /login', async () => {
    const { default: middleware } = await import('@/middleware')
    const res = middleware(makeReq('/dashboard', false) as never, {} as never)
    expect(res).toBeInstanceOf(Response)
    const location = (res as unknown as Response).headers.get('location')
    expect(location).toContain('/login')
  })

  it('does not redirect an unauthenticated visitor already on /login', async () => {
    const { default: middleware } = await import('@/middleware')
    const res = middleware(makeReq('/login', false) as never, {} as never)
    expect(res).toBeUndefined()
  })

  it('does not redirect an unauthenticated visitor already on /denied', async () => {
    const { default: middleware } = await import('@/middleware')
    const res = middleware(makeReq('/denied', false) as never, {} as never)
    expect(res).toBeUndefined()
  })

  it('does not redirect an authenticated visitor on a protected path', async () => {
    const { default: middleware } = await import('@/middleware')
    const res = middleware(makeReq('/dashboard', true) as never, {} as never)
    expect(res).toBeUndefined()
  })

  it('exports a matcher that excludes api, static assets, and favicon', async () => {
    const { config } = await import('@/middleware')
    expect(config.matcher).toEqual(['/((?!api|_next/static|_next/image|favicon.ico).*)'])
  })
})
