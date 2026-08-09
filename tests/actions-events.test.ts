import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const requireUser = vi.fn()
const revalidatePath = vi.fn()

const eventFindMany = vi.fn()
const eventFindFirst = vi.fn()
const eventCreate = vi.fn()
const eventUpdate = vi.fn()

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
    event: {
      findMany: (...args: unknown[]) => eventFindMany(...args),
      findFirst: (...args: unknown[]) => eventFindFirst(...args),
      create: (...args: unknown[]) => eventCreate(...args),
      update: (...args: unknown[]) => eventUpdate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

const { listEvents, createEvent, archiveEvent, getOrCreateTodayEvent } = await import(
  '@/lib/actions/events'
)

beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  eventFindMany.mockReset()
  eventFindFirst.mockReset()
  eventCreate.mockReset()
  eventUpdate.mockReset()
})

describe('listEvents', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(listEvents()).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('returns non-archived events for an authenticated user', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([{ id: '1' }])
    const result = await listEvents()
    expect(result).toEqual([{ id: '1' }])
    expect(eventFindMany).toHaveBeenCalledWith({
      where: { isArchived: false },
      orderBy: [{ serviceDate: 'desc' }, { name: 'asc' }],
      take: 50,
    })
  })
})

describe('createEvent', () => {
  it('rejects a non-admin before touching validation or the database', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(createEvent({ name: 'Bad', serviceDate: 'not-a-date' })).rejects.toThrow(
      AuthzError
    )
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid input even for an admin', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(createEvent({ name: '', serviceDate: 'not-a-date' })).rejects.toThrow()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('creates the event and revalidates for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
    const result = await createEvent({ name: 'Sunday', serviceDate: '2026-08-09' })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Sunday', serviceDate: '2026-08-09' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(result).toEqual({ id: '1', name: 'Sunday', serviceDate: '2026-08-09' })
  })
})

describe('archiveEvent', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(archiveEvent('id1')).rejects.toThrow(AuthzError)
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty id', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(archiveEvent('')).rejects.toThrow()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('archives the event for a valid admin call', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await archiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: true } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
  })
})

describe('getOrCreateTodayEvent', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(getOrCreateTodayEvent()).rejects.toThrow(AuthzError)
    expect(eventFindFirst).not.toHaveBeenCalled()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns the existing event for today without creating one', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindFirst.mockResolvedValue({ id: 'existing' })
    const result = await getOrCreateTodayEvent()
    expect(result).toEqual({ id: 'existing' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('creates a new event for today when none exists', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindFirst.mockResolvedValue(null)
    eventCreate.mockResolvedValue({ id: 'new' })
    const result = await getOrCreateTodayEvent()
    expect(result).toEqual({ id: 'new' })
    expect(eventCreate).toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
  })
})
