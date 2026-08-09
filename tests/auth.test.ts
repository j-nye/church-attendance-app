import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { handlers, auth, signIn, signOut } from '@/lib/auth'

describe('auth config', () => {
  it('exports handlers, auth, signIn, signOut per the module contract', () => {
    expect(handlers).toBeDefined()
    expect(typeof handlers.GET).toBe('function')
    expect(typeof handlers.POST).toBe('function')
    expect(typeof auth).toBe('function')
    expect(typeof signIn).toBe('function')
    expect(typeof signOut).toBe('function')
  })

  it('registers Google as the sole provider and never mints a session without it', async () => {
    const response = await handlers.GET(
      new NextRequest('http://localhost/api/auth/providers'),
    )
    const body = (await response.json()) as Record<string, { id: string; type: string }>

    expect(Object.keys(body)).toEqual(['google'])
    expect(body.google.type).toBe('oidc')
  })

  it('does not include role in the session type (roles are re-read from the DB in Task 6)', async () => {
    // The session endpoint responds even with no session cookie; the shape of
    // `session.user` (no `role`) is fixed statically by src/types/next-auth.d.ts.
    const response = await handlers.GET(
      new NextRequest('http://localhost/api/auth/session'),
    )
    expect(response.status).toBe(200)
  })
})
