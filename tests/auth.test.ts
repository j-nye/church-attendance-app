import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { handlers, auth, signIn, signOut, signInCallback } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// These tests exercise the real Neon database (same convention as
// tests/prisma-schema.test.ts): they only run when DATABASE_URL is available
// locally via .env.local; CI's `npm test` step has no database credentials,
// so this whole suite skips there.
const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('signInCallback (allowlist gate, live database)', () => {
  const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const activeEmail = `${runId}-active@example.com`
  const inactiveEmail = `${runId}-inactive@example.com`
  const notAllowlistedEmail = `${runId}-not-allowlisted@example.com`
  const initialSub = `google-sub-${runId}-initial`
  const rotatedSub = `google-sub-${runId}-rotated`

  beforeAll(async () => {
    await prisma.allowlist.create({
      data: { email: activeEmail, isActive: true },
    })
    await prisma.allowlist.create({
      data: { email: inactiveEmail, isActive: false },
    })
  })

  afterAll(async () => {
    await prisma.allowlist.deleteMany({
      where: { email: { in: [activeEmail, inactiveEmail, notAllowlistedEmail] } },
    })
  })

  it('rejects an email that has no allowlist row at all', async () => {
    const result = await signInCallback({
      profile: { email: notAllowlistedEmail, email_verified: true, sub: 'irrelevant-sub' },
    })
    expect(result).toBe(false)
  })

  it('rejects an allowlist row with isActive: false', async () => {
    const result = await signInCallback({
      profile: { email: inactiveEmail, email_verified: true, sub: 'irrelevant-sub' },
    })
    expect(result).toBe(false)
  })

  it('rejects a profile whose email is not verified, even if allowlisted and active', async () => {
    const result = await signInCallback({
      profile: { email: activeEmail, email_verified: false, sub: 'irrelevant-sub' },
    })
    expect(result).toBe(false)
  })

  it('rejects when email_verified is missing entirely', async () => {
    const result = await signInCallback({
      profile: { email: activeEmail, sub: 'irrelevant-sub' },
    })
    expect(result).toBe(false)
  })

  it('accepts a valid, active, verified allowlisted email and binds googleSub on first sign-in', async () => {
    const result = await signInCallback({
      profile: { email: activeEmail, email_verified: true, sub: initialSub },
    })
    expect(result).toBe(true)

    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email: activeEmail } })
    expect(row.googleSub).toBe(initialSub)
  })

  it('re-binds googleSub when it changes on a later sign-in for the same email', async () => {
    const result = await signInCallback({
      profile: { email: activeEmail, email_verified: true, sub: rotatedSub },
    })
    expect(result).toBe(true)

    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email: activeEmail } })
    expect(row.googleSub).toBe(rotatedSub)
  })

  it('matches the allowlist case-insensitively via lowercased email', async () => {
    const result = await signInCallback({
      profile: { email: activeEmail.toUpperCase(), email_verified: true, sub: rotatedSub },
    })
    expect(result).toBe(true)
  })
})

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
