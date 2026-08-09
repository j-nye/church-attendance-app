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

const { listAllowlist, addAllowlistEntry, deactivateAllowlistEntry } = await import(
  '@/lib/actions/allowlist'
)

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
