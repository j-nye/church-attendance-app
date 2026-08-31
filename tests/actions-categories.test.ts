import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

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
  createCategoryAction,
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
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: true },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('passes an explicit countsTowardTotal: false through to the create call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '2' })
    await createCategory({ name: 'Salvations', type: 'SERVICE_METRIC', countsTowardTotal: false })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Salvations', type: 'SERVICE_METRIC', svgKey: null, countsTowardTotal: false },
    })
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

function categoryFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('createCategoryAction', () => {
  it('returns { ok: true } and creates the category for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '1' })

    const result = await createCategoryAction({ ok: true }, categoryFormData({ name: 'Nursery', type: 'CLASSROOM' }))

    expect(result).toEqual({ ok: true })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: false },
    })
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await createCategoryAction({ ok: true }, categoryFormData({ name: '', type: 'SECTION' }))

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate name+type instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`,`type`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['name', 'type'] },
      })
    )

    const result = await createCategoryAction(
      { ok: true },
      categoryFormData({ name: 'Nursery', type: 'CLASSROOM' })
    )

    expect(result).toEqual({ ok: false, message: 'A category with that name and type already exists.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await createCategoryAction(
      { ok: true },
      categoryFormData({ name: 'Nursery', type: 'CLASSROOM' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockRejectedValue(new Error('connection reset'))

    await expect(
      createCategoryAction({ ok: true }, categoryFormData({ name: 'Nursery', type: 'CLASSROOM' }))
    ).rejects.toThrow('connection reset')
  })
})
