import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const requireAdmin = vi.fn()
const requireUser = vi.fn()
const revalidatePath = vi.fn()

const categoryFindMany = vi.fn()
const categoryCreate = vi.fn()
const categoryUpdate = vi.fn()
const categoryAggregate = vi.fn()
const categoryFindUnique = vi.fn()
const categoryDelete = vi.fn()
const attendanceRecordCount = vi.fn()
const txCategoryFindUnique = vi.fn()
const txCategoryFindFirst = vi.fn()
const txCategoryUpdate = vi.fn()
// The interactive-transaction callback is invoked for real here, against a
// fake tx client, so moveCategory's actual swap logic runs in tests — not
// just the top-level prisma mock.
const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    category: {
      findUnique: (...args: unknown[]) => txCategoryFindUnique(...args),
      findFirst: (...args: unknown[]) => txCategoryFindFirst(...args),
      update: (...args: unknown[]) => txCategoryUpdate(...args),
    },
  })
)

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
      aggregate: (...args: unknown[]) => categoryAggregate(...args),
      findUnique: (...args: unknown[]) => categoryFindUnique(...args),
      delete: (...args: unknown[]) => categoryDelete(...args),
    },
    attendanceRecord: {
      count: (...args: unknown[]) => attendanceRecordCount(...args),
    },
    $transaction: (...args: [callback: (tx: unknown) => Promise<unknown>]) => transaction(...args),
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
  moveCategory,
  renameCategory,
  renameCategoryAction,
  reactivateCategory,
  updateCategory,
  deleteCategory,
} = await import('@/lib/actions/categories')

beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  categoryFindMany.mockReset()
  categoryCreate.mockReset()
  categoryUpdate.mockReset()
  categoryAggregate.mockReset()
  categoryFindUnique.mockReset()
  categoryDelete.mockReset()
  attendanceRecordCount.mockReset()
  transaction.mockClear()
  txCategoryFindUnique.mockReset()
  txCategoryFindFirst.mockReset()
  txCategoryUpdate.mockReset()
  // Most tests don't care about the max-sortOrder lookup — default it to
  // "no active categories of this type yet" so only the tests that
  // specifically exercise the sortOrder logic need to override it.
  categoryAggregate.mockResolvedValue({ _max: { sortOrder: null } })
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
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: true, sortOrder: 0 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('passes an explicit countsTowardTotal: false through to the create call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '2' })
    await createCategory({ name: 'Salvations', type: 'SERVICE_METRIC', countsTowardTotal: false })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Salvations', type: 'SERVICE_METRIC', svgKey: null, countsTowardTotal: false, sortOrder: 0 },
    })
  })

  it('sets sortOrder to one past the current max active same-type sortOrder', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: 4 } })
    categoryCreate.mockResolvedValue({ id: '3' })

    await createCategory({ name: 'Guardians', type: 'SERVE_TEAM' })

    expect(categoryAggregate).toHaveBeenCalledWith({
      where: { type: 'SERVE_TEAM', isActive: true },
      _max: { sortOrder: true },
    })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sortOrder: 5 }),
    })
  })

  it('lands two new categories of the same type at consecutive, non-colliding sortOrders', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryAggregate.mockResolvedValueOnce({ _max: { sortOrder: null } })
    categoryCreate.mockResolvedValueOnce({ id: 'first' })
    await createCategory({ name: 'First', type: 'GROWTH_TRACK' })
    expect(categoryCreate).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ sortOrder: 0 }) })

    categoryAggregate.mockResolvedValueOnce({ _max: { sortOrder: 0 } })
    categoryCreate.mockResolvedValueOnce({ id: 'second' })
    await createCategory({ name: 'Second', type: 'GROWTH_TRACK' })
    expect(categoryCreate).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ sortOrder: 1 }) })
  })
})

describe('moveCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(moveCategory({ id: 'id1', direction: 'up' })).rejects.toThrow(AuthzError)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects an invalid direction', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(moveCategory({ id: 'id1', direction: 'sideways' })).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('is a graceful no-op when the category no longer exists or is inactive', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: false })

    await expect(moveCategory({ id: 'id1', direction: 'up' })).resolves.toBeUndefined()
    expect(txCategoryFindFirst).not.toHaveBeenCalled()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('is a graceful no-op at the top boundary — no throw, no update', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null) // already first — no smaller sortOrder in this type

    await expect(moveCategory({ id: 'id1', direction: 'up' })).resolves.toBeUndefined()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('is a graceful no-op at the bottom boundary — no throw, no update', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 4, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null) // already last — no larger sortOrder in this type

    await expect(moveCategory({ id: 'id1', direction: 'down' })).resolves.toBeUndefined()
    expect(txCategoryUpdate).not.toHaveBeenCalled()
  })

  it('swaps sortOrder with the adjacent active category of the same type when moving up', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id2', type: 'SECTION', sortOrder: 2, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id1', sortOrder: 1 })

    await moveCategory({ id: 'id2', direction: 'up' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith({
      where: { type: 'SECTION', isActive: true, id: { not: 'id2' }, sortOrder: { lt: 2 } },
      orderBy: { sortOrder: 'desc' },
    })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id2' }, data: { sortOrder: 1 } })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { sortOrder: 2 } })
  })

  it('swaps sortOrder with the adjacent active category of the same type when moving down', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith({
      where: { type: 'SECTION', isActive: true, id: { not: 'id1' }, sortOrder: { gt: 1 } },
      orderBy: { sortOrder: 'asc' },
    })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { sortOrder: 2 } })
    expect(txCategoryUpdate).toHaveBeenCalledWith({ where: { id: 'id2' }, data: { sortOrder: 1 } })
  })

  it('scopes the neighbor search to the same type — cross-type isolation', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM', sortOrder: 3, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id9', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'up' })

    expect(txCategoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'CLASSROOM' }) })
    )
  })

  it('does the read and both writes inside a single transaction', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('revalidates settings and every entry page after a successful swap', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 1, isActive: true })
    txCategoryFindFirst.mockResolvedValue({ id: 'id2', sortOrder: 2 })

    await moveCategory({ id: 'id1', direction: 'down' })

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('does not revalidate anything on a graceful no-op', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    txCategoryFindUnique.mockResolvedValue({ id: 'id1', type: 'SECTION', sortOrder: 0, isActive: true })
    txCategoryFindFirst.mockResolvedValue(null)

    await moveCategory({ id: 'id1', direction: 'up' })

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('renameCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(renameCategory({ id: 'id1', name: 'New' })).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(renameCategory({ id: 'id1', name: '' })).rejects.toThrow()
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('renames the category and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1', name: 'New Name' })

    await renameCategory({ id: 'id1', name: 'New Name' })

    expect(categoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { name: 'New Name' } })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})

function renameFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('renameCategoryAction', () => {
  it('returns { ok: true } and renames the category for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1', name: 'New Name' })

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'New Name' }))

    expect(result).toEqual({ ok: true })
    expect(categoryUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { name: 'New Name' } })
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: '' }))

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate name+type instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`,`type`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['name', 'type'] },
      })
    )

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))

    expect(result).toEqual({ ok: false, message: 'A category with that name and type already exists.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockRejectedValue(new Error('connection reset'))

    await expect(
      renameCategoryAction({ ok: true }, renameFormData({ id: 'id1', name: 'Nursery' }))
    ).rejects.toThrow('connection reset')
  })
})

describe('reactivateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(reactivateCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the category no longer exists', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue(null)
    await expect(reactivateCategory('id1')).rejects.toThrow('No such category')
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('reassigns sortOrder to one past the current max active same-type sortOrder', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: 4 } })

    await reactivateCategory('id1')

    expect(categoryAggregate).toHaveBeenCalledWith({
      where: { type: 'CLASSROOM', isActive: true },
      _max: { sortOrder: true },
    })
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: true, sortOrder: 5 },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })

  it('starts at sortOrder 0 when no active category of that type exists yet', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryFindUnique.mockResolvedValue({ id: 'id1', type: 'CLASSROOM' })
    categoryAggregate.mockResolvedValue({ _max: { sortOrder: null } })

    await reactivateCategory('id1')

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: true, sortOrder: 0 },
    })
  })
})

describe('updateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(
      updateCategory({ id: 'id1', type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' })
    ).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('rejects an invalid type', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(
      updateCategory({ id: 'id1', type: 'BOGUS', countsTowardTotal: true, svgKey: null })
    ).rejects.toThrow()
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('keeps svgKey when the type stays SECTION', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'SECTION', countsTowardTotal: true, svgKey: 'left-wing' },
    })
  })

  it('clears svgKey server-side when the type changes away from SECTION, even if the caller still sent one', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'CLASSROOM', countsTowardTotal: true, svgKey: 'left-wing' })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'CLASSROOM', countsTowardTotal: true, svgKey: null },
    })
  })

  it('updates countsTowardTotal and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryUpdate.mockResolvedValue({ id: 'id1' })

    await updateCategory({ id: 'id1', type: 'SERVICE_METRIC', countsTowardTotal: false, svgKey: null })

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { type: 'SERVICE_METRIC', countsTowardTotal: false, svgKey: null },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})

describe('deleteCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(deleteCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('refuses when the category still has attendance records', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    attendanceRecordCount.mockResolvedValue(3)

    await expect(deleteCategory('id1')).rejects.toThrow(
      'This category has recorded attendance and cannot be deleted — hide it instead.'
    )
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('refuses even when the caller believes the category is unused — a race where a record appeared between render and click', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    // Simulates a volunteer recording a count in the moment between the
    // settings page rendering hasRecords: false and the admin clicking
    // Delete — the server always re-checks, never trusts what the UI last saw.
    attendanceRecordCount.mockResolvedValue(1)

    await expect(deleteCategory('id1')).rejects.toThrow('cannot be deleted')
    expect(categoryDelete).not.toHaveBeenCalled()
  })

  it('hard-deletes when no attendance records exist, and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    attendanceRecordCount.mockResolvedValue(0)
    categoryDelete.mockResolvedValue({ id: 'id1' })

    await deleteCategory('id1')

    expect(attendanceRecordCount).toHaveBeenCalledWith({ where: { categoryId: 'id1' } })
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: 'id1' } })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
  })
})

describe('deactivateCategory', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(deactivateCategory('id1')).rejects.toThrow(AuthzError)
    expect(categoryUpdate).not.toHaveBeenCalled()
  })

  it('deactivates for a valid admin call and revalidates settings and every entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await deactivateCategory('id1')
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: false },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/[eventId]', 'page')
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
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: false, sortOrder: 0 },
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
