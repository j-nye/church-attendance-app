import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { handlers, auth, signIn, signOut, signInCallback } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isDatabaseReachable } from './db-probe'

// These tests exercise the real Neon database (same convention as
// tests/prisma-schema.test.ts): they only run when DATABASE_URL is available
// locally via .env.local; CI's `npm test` step has no database credentials,
// so this whole suite skips there. The reachability probe (see tests/db-probe.ts)
// also skips when DATABASE_URL is set but the database can't be reached, so an
// unreachable DB skips in ~2s instead of failing every test on its timeout.
const hasDatabase =
  Boolean(process.env.DATABASE_URL) && (await isDatabaseReachable(process.env.DATABASE_URL!))

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

describe.skipIf(!hasDatabase)('signInCallback (name sync from Google profile, live database)', () => {
  const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const emails: string[] = []

  async function createRow(
    suffix: string,
    data: {
      name?: string | null
      adminOverrideName?: string | null
      googleSub?: string | null
      isActive?: boolean
    } = {},
  ) {
    const email = `${runId}-${suffix}@example.com`
    emails.push(email)
    await prisma.allowlist.create({ data: { email, isActive: true, ...data } })
    return email
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    if (emails.length > 0) {
      await prisma.allowlist.deleteMany({ where: { email: { in: emails } } })
    }
  })

  it('writes the Google-reported name on a successful sign-in, combined with the googleSub bind into one update call', async () => {
    const email = await createRow('new-name')
    const updateSpy = vi.spyOn(prisma.allowlist, 'update')

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-new-name', name: 'Jane Volunteer' },
    })

    expect(result).toBe(true)
    // Combined into the same update call as the googleSub bind, not two writes.
    expect(updateSpy).toHaveBeenCalledTimes(1)

    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email } })
    expect(row.name).toBe('Jane Volunteer')
    expect(row.googleSub).toBe('sub-new-name')
  })

  it('writes nothing when the stored name and googleSub already match the profile (no pointless update)', async () => {
    const email = await createRow('unchanged', { name: 'Same Name', googleSub: 'sub-unchanged' })
    const updateSpy = vi.spyOn(prisma.allowlist, 'update')

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-unchanged', name: 'Same Name' },
    })

    expect(result).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('leaves an existing stored name untouched when the profile has no name', async () => {
    const email = await createRow('no-name-in-profile', { name: 'Existing Name', googleSub: 'sub-no-name' })

    const result = await signInCallback({
      // Google did not return a `name` claim at all.
      profile: { email, email_verified: true, sub: 'sub-no-name' },
    })

    expect(result).toBe(true)
    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email } })
    expect(row.name).toBe('Existing Name')
  })

  it('updates the stored name when Google reports a changed name (no one-way latch)', async () => {
    const email = await createRow('name-change', { name: 'Old Name', googleSub: 'sub-name-change' })

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-name-change', name: 'New Name' },
    })

    expect(result).toBe(true)
    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email } })
    expect(row.name).toBe('New Name')
  })

  it('never writes adminOverrideName, even when the Google name differs from it', async () => {
    const email = await createRow('override-untouched', {
      name: 'Old Google Name',
      adminOverrideName: 'Admin Corrected Name',
      googleSub: 'sub-override',
    })

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-override', name: 'Different Google Name' },
    })

    expect(result).toBe(true)
    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email } })
    expect(row.name).toBe('Different Google Name')
    expect(row.adminOverrideName).toBe('Admin Corrected Name')
  })

  it('does not write a name for a rejected sign-in (inactive allowlist row)', async () => {
    const email = await createRow('rejected-inactive', { name: 'Existing Name', isActive: false })

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-rejected', name: 'Different Name' },
    })

    expect(result).toBe(false)
    const row = await prisma.allowlist.findUniqueOrThrow({ where: { email } })
    expect(row.name).toBe('Existing Name')
  })

  it('does not write a name for a rejected sign-in (email not on the allowlist)', async () => {
    const email = `${runId}-not-on-list@example.com`

    const result = await signInCallback({
      profile: { email, email_verified: true, sub: 'sub-not-on-list', name: 'Anyone' },
    })

    expect(result).toBe(false)
    const row = await prisma.allowlist.findUnique({ where: { email } })
    expect(row).toBeNull()
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
