import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const requireUser = vi.fn()
const revalidatePath = vi.fn()

const categoryFindMany = vi.fn()
const categoryCreate = vi.fn()
const categoryUpdate = vi.fn()

class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code)
  }
}

vi.mock('@/lib/authz', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
  AuthzError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findMany: (...args: unknown[]) => categoryFindMany(...args),
      create: (...args: unknown[]) => categoryCreate(...args),
      update: (...args: unknown[]) => categoryUpdate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

const {
  listActiveCategories,
  createCategory,
  deactivateCategory,
} = await import('@/lib/actions/categories')

beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  categoryFindMany.mockReset()
  categoryCreate.mockReset()
  categoryUpdate.mockReset()
})

describe('listActiveCategories', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(listActiveCategories()).rejects.toThrow(AuthzError)
    expect(categoryFindMany).not.toHaveBeenCalled()
  })

  it('returns active categories in the right order', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    categoryFindMany.mockResolvedValue([{ id: '1' }])
    const result = await listActiveCategories()
    expect(result).toEqual([{ id: '1' }])
    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })
  })
})

describe('createCategory', () => {
  it('rejects a non-admin before validation', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(createCategory({ name: '', type: 'bogus' })).rejects.toThrow(AuthzError)
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid input for an admin', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(createCategory({ name: '', type: 'SECTION' })).rejects.toThrow()
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('creates the category for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '1' })
    const result = await createCategory({ name: 'Nursery', type: 'CLASSROOM' })
    expect(result).toEqual({ id: '1' })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })
})

describe('deactivateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(deactivateCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('deactivates for a valid admin call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await deactivateCategory('id1')
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: false },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })
})
