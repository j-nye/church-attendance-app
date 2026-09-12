import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const revalidatePath = vi.fn()

const allowlistFindMany = vi.fn()
const allowlistUpsert = vi.fn()
const allowlistFindUnique = vi.fn()
const allowlistCount = vi.fn()
const allowlistUpdate = vi.fn()

class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code)
  }
}

vi.mock('@/lib/authz', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  AuthzError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowlist: {
      findMany: (...args: unknown[]) => allowlistFindMany(...args),
      upsert: (...args: unknown[]) => allowlistUpsert(...args),
      findUnique: (...args: unknown[]) => allowlistFindUnique(...args),
      count: (...args: unknown[]) => allowlistCount(...args),
      update: (...args: unknown[]) => allowlistUpdate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

const {
  listAllowlist,
  addAllowlistEntry,
  deactivateAllowlistEntry,
  addAllowlistEntryAction,
  updateAllowlistName,
  updateAllowlistNameAction,
} = await import('@/lib/actions/allowlist')

const admin = { email: 'admin@example.com', role: 'ADMIN' as const }

beforeEach(() => {
  requireAdmin.mockReset()
  revalidatePath.mockReset()
  allowlistFindMany.mockReset()
  allowlistUpsert.mockReset()
  allowlistFindUnique.mockReset()
  allowlistCount.mockReset()
  allowlistUpdate.mockReset()
})

describe('listAllowlist', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(listAllowlist()).rejects.toThrow(AuthzError)
    expect(allowlistFindMany).not.toHaveBeenCalled()
  })

  it('lists entries for an admin', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindMany.mockResolvedValue([{ id: '1' }])
    const result = await listAllowlist()
    expect(result).toEqual([{ id: '1' }])
  })

  it('orders by isActive desc, then role asc, then display name, then email asc', async () => {
    // Deliberately returned from the mock in a scrambled order: listAllowlist
    // must not rely on Prisma-level orderBy alone to produce the right
    // sequence, since Postgres cannot sort on COALESCE(adminOverrideName,
    // name) through Prisma's query builder. Phase 3's grouping UI depends on
    // this ordering being correct, so it gets its own explicit assertion.
    requireAdmin.mockResolvedValue(admin)
    allowlistFindMany.mockResolvedValue([
      {
        id: '1',
        email: 'zoe@example.com',
        role: 'VOLUNTEER',
        isActive: true,
        name: 'Zoe',
        adminOverrideName: null,
      },
      {
        id: '2',
        email: 'amy@example.com',
        role: 'ADMIN',
        isActive: true,
        name: 'Amy',
        adminOverrideName: null,
      },
      {
        id: '3',
        email: 'bob@example.com',
        role: 'VOLUNTEER',
        isActive: false,
        name: 'Bob',
        adminOverrideName: null,
      },
      {
        // No `name` at all — the admin override is the only display name
        // available, and it sorts before 'Zoe' among the active volunteers.
        id: '4',
        email: 'carl@example.com',
        role: 'VOLUNTEER',
        isActive: true,
        name: null,
        adminOverrideName: 'Aaron',
      },
    ])

    const result = await listAllowlist()

    expect(result.map((entry: { id: string }) => entry.id)).toEqual(['2', '4', '1', '3'])
  })
})

describe('addAllowlistEntry', () => {
  it('rejects a non-admin before validation', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(addAllowlistEntry({ email: 'not-an-email', role: 'ADMIN' })).rejects.toThrow(
      AuthzError
    )
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('rejects an invalid email for an admin', async () => {
    requireAdmin.mockResolvedValue(admin)
    await expect(addAllowlistEntry({ email: 'not-an-email', role: 'ADMIN' })).rejects.toThrow()
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('upserts a normalized entry for valid admin input', async () => {
    requireAdmin.mockResolvedValue(admin)
    await addAllowlistEntry({ email: 'New@Example.com', role: 'VOLUNTEER' })
    expect(allowlistUpsert).toHaveBeenCalledWith({
      where: { email: 'new@example.com' },
      update: { role: 'VOLUNTEER', isActive: true },
      create: { email: 'new@example.com', role: 'VOLUNTEER', isActive: true },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })
})

describe('deactivateAllowlistEntry', () => {
  it('rejects a non-admin before looking anything up', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(deactivateAllowlistEntry('id1')).rejects.toThrow(AuthzError)
    expect(allowlistFindUnique).not.toHaveBeenCalled()
  })

  it('rejects an invalid id for an admin', async () => {
    requireAdmin.mockResolvedValue(admin)
    await expect(deactivateAllowlistEntry('')).rejects.toThrow()
    expect(allowlistFindUnique).not.toHaveBeenCalled()
  })

  it('throws when the target entry does not exist', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue(null)
    await expect(deactivateAllowlistEntry('missing')).rejects.toThrow('No such allowlist entry')
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('prevents an admin from removing their own access', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({
      id: 'id1',
      email: admin.email,
      role: 'ADMIN',
      isActive: true,
    })
    await expect(deactivateAllowlistEntry('id1')).rejects.toThrow(
      'You cannot remove your own access'
    )
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('prevents removing the last active admin', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({
      id: 'id2',
      email: 'other-admin@example.com',
      role: 'ADMIN',
      isActive: true,
    })
    allowlistCount.mockResolvedValue(1)
    await expect(deactivateAllowlistEntry('id2')).rejects.toThrow(
      'Cannot remove the last active admin — promote someone else first'
    )
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('allows removing an admin when other active admins remain', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({
      id: 'id2',
      email: 'other-admin@example.com',
      role: 'ADMIN',
      isActive: true,
    })
    allowlistCount.mockResolvedValue(2)
    await deactivateAllowlistEntry('id2')
    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id2' },
      data: { isActive: false },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('allows deactivating a non-admin volunteer', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({
      id: 'id3',
      email: 'vol@example.com',
      role: 'VOLUNTEER',
      isActive: true,
    })
    await deactivateAllowlistEntry('id3')
    expect(allowlistCount).not.toHaveBeenCalled()
    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id3' },
      data: { isActive: false },
    })
  })
})

describe('updateAllowlistName', () => {
  it('rejects a non-admin before looking anything up', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(updateAllowlistName({ id: 'id1', name: 'Jane Doe' })).rejects.toThrow(AuthzError)
    expect(allowlistFindUnique).not.toHaveBeenCalled()
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('rejects a name over the length cap for an admin', async () => {
    requireAdmin.mockResolvedValue(admin)
    await expect(updateAllowlistName({ id: 'id1', name: 'x'.repeat(81) })).rejects.toThrow()
    expect(allowlistFindUnique).not.toHaveBeenCalled()
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('trims the name before writing adminOverrideName', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({ id: 'id1', email: 'vol@example.com' })

    await updateAllowlistName({ id: 'id1', name: '  Jane Doe  ' })

    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { adminOverrideName: 'Jane Doe' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('clears adminOverrideName back to null for an empty string', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({ id: 'id1', email: 'vol@example.com' })

    await updateAllowlistName({ id: 'id1', name: '' })

    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { adminOverrideName: null },
    })
  })

  it('clears adminOverrideName back to null for a whitespace-only string', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({ id: 'id1', email: 'vol@example.com' })

    await updateAllowlistName({ id: 'id1', name: '   ' })

    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { adminOverrideName: null },
    })
  })

  it('throws a clean error when the target entry does not exist, not a raw Prisma error', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue(null)

    await expect(updateAllowlistName({ id: 'missing', name: 'Jane Doe' })).rejects.toThrow(
      'No such allowlist entry'
    )
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })
})

function allowlistFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('addAllowlistEntryAction', () => {
  it('returns { ok: true } and upserts the entry for valid input', async () => {
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'New@Example.com', role: 'VOLUNTEER' })
    )

    expect(result).toEqual({ ok: true })
    expect(allowlistUpsert).toHaveBeenCalledWith({
      where: { email: 'new@example.com' },
      update: { role: 'VOLUNTEER', isActive: true },
      create: { email: 'new@example.com', role: 'VOLUNTEER', isActive: true },
    })
  })

  it('returns a friendly inline message instead of throwing for a malformed email', async () => {
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'not-an-email', role: 'ADMIN' })
    )

    expect(result).toEqual({ ok: false, message: "Email address doesn't look like a valid email address." })
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'new@example.com', role: 'VOLUNTEER' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('re-adding an existing email is a normal update, not an error', async () => {
    // addAllowlistEntry upserts on the unique email column, so there is no
    // duplicate-email failure mode for this action to catch — see the
    // plan's "Conflicts found" section.
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: admin.email, role: 'ADMIN' })
    )

    expect(result).toEqual({ ok: true })
    expect(allowlistUpsert).toHaveBeenCalledWith({
      where: { email: admin.email },
      update: { role: 'ADMIN', isActive: true },
      create: { email: admin.email, role: 'ADMIN', isActive: true },
    })
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistUpsert.mockRejectedValue(new Error('connection reset'))

    await expect(
      addAllowlistEntryAction({ ok: true }, allowlistFormData({ email: 'new@example.com', role: 'VOLUNTEER' }))
    ).rejects.toThrow('connection reset')
  })
})

describe('updateAllowlistNameAction', () => {
  it('returns { ok: true } and writes adminOverrideName for valid input', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({ id: 'id1', email: 'vol@example.com' })

    const result = await updateAllowlistNameAction(
      { ok: true },
      allowlistFormData({ id: 'id1', name: 'Jane Doe' })
    )

    expect(result).toEqual({ ok: true })
    expect(allowlistUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { adminOverrideName: 'Jane Doe' },
    })
  })

  it('returns a friendly inline message instead of throwing for a name over the length cap', async () => {
    requireAdmin.mockResolvedValue(admin)

    const result = await updateAllowlistNameAction(
      { ok: true },
      allowlistFormData({ id: 'id1', name: 'x'.repeat(81) })
    )

    expect(result).toEqual({ ok: false, message: 'Name is too long.' })
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await updateAllowlistNameAction(
      { ok: true },
      allowlistFormData({ id: 'id1', name: 'Jane Doe' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(allowlistUpdate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue({ id: 'id1', email: 'vol@example.com' })
    allowlistUpdate.mockRejectedValue(new Error('connection reset'))

    await expect(
      updateAllowlistNameAction({ ok: true }, allowlistFormData({ id: 'id1', name: 'Jane Doe' }))
    ).rejects.toThrow('connection reset')
  })

  it('rethrows the clean not-found error rather than swallowing it', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistFindUnique.mockResolvedValue(null)

    await expect(
      updateAllowlistNameAction({ ok: true }, allowlistFormData({ id: 'missing', name: 'Jane Doe' }))
    ).rejects.toThrow('No such allowlist entry')
  })
})
