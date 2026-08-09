import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()
const authMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { allowlist: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}))
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }))

const { requireUser, requireAdmin, AuthzError } = await import('@/lib/authz')

beforeEach(() => {
  findUnique.mockReset()
  authMock.mockReset()
})

describe('requireUser', () => {
  it('rejects when there is no session', async () => {
    authMock.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow(AuthzError)
  })

  it('rejects a session with no email', async () => {
    authMock.mockResolvedValue({ user: {} })
    await expect(requireUser()).rejects.toThrow(AuthzError)
  })

  it('rejects a valid session whose email is not on the allowlist', async () => {
    authMock.mockResolvedValue({ user: { email: 'stranger@example.com' } })
    findUnique.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow(AuthzError)
  })

  it('rejects a user who has been deactivated — revocation is immediate', async () => {
    authMock.mockResolvedValue({ user: { email: 'former@example.com' } })
    findUnique.mockResolvedValue({ email: 'former@example.com', role: 'VOLUNTEER', isActive: false })
    await expect(requireUser()).rejects.toThrow(AuthzError)
  })

  it('returns the role from the database, not from the session', async () => {
    authMock.mockResolvedValue({ user: { email: 'vol@example.com', role: 'ADMIN' } })
    findUnique.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER', isActive: true })
    await expect(requireUser()).resolves.toEqual({ email: 'vol@example.com', role: 'VOLUNTEER' })
  })

  it('looks the user up by lowercased email', async () => {
    authMock.mockResolvedValue({ user: { email: 'Mixed@Example.COM' } })
    findUnique.mockResolvedValue({ email: 'mixed@example.com', role: 'VOLUNTEER', isActive: true })
    await requireUser()
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'mixed@example.com' } })
  })
})

describe('requireAdmin', () => {
  it('rejects a volunteer', async () => {
    authMock.mockResolvedValue({ user: { email: 'vol@example.com' } })
    findUnique.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER', isActive: true })
    await expect(requireAdmin()).rejects.toThrow(AuthzError)
  })

  it('allows an admin', async () => {
    authMock.mockResolvedValue({ user: { email: 'boss@example.com' } })
    findUnique.mockResolvedValue({ email: 'boss@example.com', role: 'ADMIN', isActive: true })
    await expect(requireAdmin()).resolves.toEqual({ email: 'boss@example.com', role: 'ADMIN' })
  })
})
