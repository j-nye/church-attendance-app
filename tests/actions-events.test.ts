import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

const requireAdmin = vi.fn()
const requireUser = vi.fn()
const revalidatePath = vi.fn()

const eventFindMany = vi.fn()
const eventFindFirst = vi.fn()
const eventFindUnique = vi.fn()
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
      findUnique: (...args: unknown[]) => eventFindUnique(...args),
      create: (...args: unknown[]) => eventCreate(...args),
      update: (...args: unknown[]) => eventUpdate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock('@/lib/prisma-errors', () => ({
  isUniqueConstraintError: (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
}))

const {
  listEvents,
  createEvent,
  archiveEvent,
  getOrCreateTodayEvent,
  listEventsInRange,
  unarchiveEvent,
  listRecentEvents,
  createEventAction,
  listTodayEvents,
  updateEventSchedule,
  updateEventScheduleAction,
} = await import('@/lib/actions/events')

beforeEach(() => {
  requireAdmin.mockReset()
  requireUser.mockReset()
  revalidatePath.mockReset()
  eventFindMany.mockReset()
  eventFindFirst.mockReset()
  eventFindUnique.mockReset()
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
      orderBy: [{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }],
      take: 50,
    })
  })
})

describe('createEvent', () => {
  it('rejects a non-admin before touching validation or the database', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(
      createEvent({ name: 'Bad', serviceDate: 'not-a-date', startTime: '09:30' })
    ).rejects.toThrow(AuthzError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid input even for an admin', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(
      createEvent({ name: '', serviceDate: 'not-a-date', startTime: '09:30' })
    ).rejects.toThrow()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects input with no startTime', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(createEvent({ name: 'Sunday', serviceDate: '2026-08-09' })).rejects.toThrow()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('creates the event and revalidates for valid admin input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({
      id: '1',
      name: 'Sunday',
      serviceDate: '2026-08-09',
      startTime: '09:30',
    })
    const result = await createEvent({
      name: 'Sunday',
      serviceDate: '2026-08-09',
      startTime: '09:30',
    })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Sunday', serviceDate: '2026-08-09', startTime: '09:30' },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(result).toEqual({
      id: '1',
      name: 'Sunday',
      serviceDate: '2026-08-09',
      startTime: '09:30',
    })
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

  it('archives the event and revalidates dashboard, settings, and its own entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await archiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: true } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
  })
})

describe('listTodayEvents', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(listTodayEvents()).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it("returns today's non-archived events ordered by startTime ascending", async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([{ id: 'e1', startTime: '09:30' }])
    const result = await listTodayEvents()
    expect(result).toEqual([{ id: 'e1', startTime: '09:30' }])
    expect(eventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startTime: 'asc' } })
    )
  })
})

describe('getOrCreateTodayEvent', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(getOrCreateTodayEvent()).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns the existing event for today without creating one when exactly one exists', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([{ id: 'existing' }])
    const result = await getOrCreateTodayEvent()
    expect(result).toEqual({ id: 'existing' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // CHANGED CONTRACT: getOrCreateTodayEvent no longer stamps a hardcoded
  // '09:30' default when creating — the caller must supply a startTime,
  // which is parsed through startTimeSchema. This test now asserts the
  // create call uses whatever startTime was passed in, not a fixed value.
  it('creates a new event for today using the startTime the caller passed in, when none exists', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([])
    eventCreate.mockResolvedValue({ id: 'new', startTime: '09:30' })
    const result = await getOrCreateTodayEvent('09:30')
    expect(result).toEqual({ id: 'new', startTime: '09:30' })
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ startTime: '09:30' }),
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  // NEW COVERAGE: a non-default time chosen by whoever is creating the
  // service must be honored end to end, not just the common 09:30 case.
  it('honors a custom startTime end to end when creating', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([])
    eventCreate.mockResolvedValue({ id: 'new', startTime: '11:15' })
    const result = await getOrCreateTodayEvent('11:15')
    expect(result).toEqual({ id: 'new', startTime: '11:15' })
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ startTime: '11:15' }),
    })
  })

  // NEW COVERAGE: the whole point of this change is that there is no more
  // invisible default — an omitted startTime on the create path must throw
  // rather than silently falling back to a hardcoded time.
  it('throws a validation error instead of silently defaulting when no startTime is given for a create', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([])
    await expect(getOrCreateTodayEvent()).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // NEW COVERAGE: same guarantee, but for a present-but-malformed value
  // rather than a missing one.
  it('throws a validation error for a malformed startTime when creating', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([])
    await expect(getOrCreateTodayEvent('9:30 AM')).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('throws before ever calling create when today already has more than one service', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])

    await expect(getOrCreateTodayEvent()).rejects.toThrow()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // Now that a create is involved, this test exercises the create path, so
  // it needs a valid startTime argument — without one, parsing would throw
  // a ZodError before ever reaching eventCreate, which is not what this
  // test is checking.
  it('re-fetches and returns the winner\'s row when create loses a concurrent-tap race (P2002)', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([]) // initial check finds nothing
    eventFindFirst.mockResolvedValue({ id: 'winner' }) // refetch after losing the create race
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    const result = await getOrCreateTodayEvent('09:30')

    expect(result).toEqual({ id: 'winner' })
    expect(eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startTime: 'asc' } })
    )
  })

  // Same reasoning: this also exercises the create path (eventFindMany
  // resolves to []), so it needs a valid startTime or it would fail for the
  // wrong reason (a ZodError, not the 'connection reset' error it's meant
  // to check propagates unchanged).
  it('still throws a non-P2002 error from create', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindMany.mockResolvedValue([])
    eventCreate.mockRejectedValue(new Error('connection reset'))

    await expect(getOrCreateTodayEvent('09:30')).rejects.toThrow('connection reset')
  })
})

describe('listEventsInRange', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(listEventsInRange('2026-08-01', '2026-08-31')).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('rejects a malformed start date before querying', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(listEventsInRange('not-a-date', '2026-08-31')).rejects.toThrow()
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('rejects a reversed range before querying', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(listEventsInRange('2026-08-31', '2026-08-01')).rejects.toThrow(
      'start must not be after end'
    )
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('queries events with serviceDate between start and end, inclusive, ordered by date then startTime then name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([{ id: 'e1' }])
    const result = await listEventsInRange('2026-08-01', '2026-08-31')
    expect(result).toEqual([{ id: 'e1' }])
    expect(eventFindMany).toHaveBeenCalledWith({
      where: { serviceDate: { gte: '2026-08-01', lte: '2026-08-31' } },
      orderBy: [{ serviceDate: 'asc' }, { startTime: 'asc' }, { name: 'asc' }],
    })
  })

  it('returns an empty array for a range that matches no events', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([])
    const result = await listEventsInRange('2020-01-01', '2020-01-31')
    expect(result).toEqual([])
  })
})

describe('unarchiveEvent', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(unarchiveEvent('id1')).rejects.toThrow(AuthzError)
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty id', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(unarchiveEvent('')).rejects.toThrow()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('un-archives the event and revalidates dashboard, settings, and its own entry page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await unarchiveEvent('id1')
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isArchived: false } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
  })
})

describe('listRecentEvents', () => {
  it('requires an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(listRecentEvents()).rejects.toThrow(AuthzError)
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('returns events including archived ones, most recent first', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindMany.mockResolvedValue([{ id: '1', isArchived: true }])
    const result = await listRecentEvents()
    expect(result).toEqual([{ id: '1', isArchived: true }])
    expect(eventFindMany).toHaveBeenCalledWith({
      orderBy: [{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }],
      take: 50,
    })
  })
})

function eventFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('createEventAction', () => {
  it('returns { ok: true } and creates the event for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockResolvedValue({ id: '1' })

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06', startTime: '09:30' })
    )

    expect(result).toEqual({ ok: true })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Sunday Service', serviceDate: '2026-09-06', startTime: '09:30' },
    })
  })

  it('returns { ok: false } with the field label for a missing startTime', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06' })
    )

    expect(result).toEqual({ ok: false, message: 'Service time is required.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: '', serviceDate: '2026-09-06', startTime: '09:30' })
    )

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate [serviceDate, name] instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06', startTime: '09:30' })
    )

    expect(result).toEqual({ ok: false, message: 'A service with that name already exists on that date.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await createEventAction(
      { ok: true },
      eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06', startTime: '09:30' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventCreate.mockRejectedValue(new Error('connection reset'))

    await expect(
      createEventAction(
        { ok: true },
        eventFormData({ name: 'Sunday Service', serviceDate: '2026-09-06', startTime: '09:30' })
      )
    ).rejects.toThrow('connection reset')
  })
})

describe('updateEventSchedule', () => {
  it('rejects a non-admin before touching validation or the database', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2026-09-06', startTime: '09:30' })
    ).rejects.toThrow(AuthzError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed time', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2026-09-06', startTime: '9:30 AM' })
    ).rejects.toThrow()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed date', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2026-02-30', startTime: '09:30' })
    ).rejects.toThrow()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('updates serviceDate and startTime together in a single write', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    await updateEventSchedule({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })

    expect(eventUpdate).toHaveBeenCalledTimes(1)
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { serviceDate: '2026-09-13', startTime: '11:00' },
    })
  })

  it('moves a service to a past date without complaint — there is no "not in the past" rule', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2000-01-02', startTime: '09:30' })
    ).resolves.toBeUndefined()
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { serviceDate: '2000-01-02', startTime: '09:30' },
    })
  })

  it('returns the friendly collision message via P2002, not a raw Prisma error', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })
    eventUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('refuses to edit an archived service', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: true })

    await expect(
      updateEventSchedule({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
    ).rejects.toThrow('That service is not accepting counts')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('errors cleanly for a nonexistent id instead of surfacing a raw P2025', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue(null)

    await expect(
      updateEventSchedule({ id: 'missing', serviceDate: '2026-09-13', startTime: '11:00' })
    ).rejects.toThrow('No such service')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('revalidates dashboard, settings, entry, report, and the manage page', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    await updateEventSchedule({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
    expect(revalidatePath).toHaveBeenCalledWith('/report/id1')
    expect(revalidatePath).toHaveBeenCalledWith('/report/id1/manage')
  })
})

describe('updateEventScheduleAction', () => {
  it('returns { ok: true } and updates the schedule for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    const result = await updateEventScheduleAction(
      { ok: true },
      eventFormData({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
    )

    expect(result).toEqual({ ok: true })
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { serviceDate: '2026-09-13', startTime: '11:00' },
    })
  })

  it('returns a friendly inline message for a malformed time instead of throwing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await updateEventScheduleAction(
      { ok: true },
      eventFormData({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00 AM' })
    )

    expect(result).toEqual({ ok: false, message: 'Service time is not valid.' })
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate [serviceDate, name] instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })
    eventUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    const result = await updateEventScheduleAction(
      { ok: true },
      eventFormData({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
    )

    expect(result).toEqual({ ok: false, message: 'A service with that name already exists on that date.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await updateEventScheduleAction(
      { ok: true },
      eventFormData({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })
    eventUpdate.mockRejectedValue(new Error('connection reset'))

    await expect(
      updateEventScheduleAction(
        { ok: true },
        eventFormData({ id: 'id1', serviceDate: '2026-09-13', startTime: '11:00' })
      )
    ).rejects.toThrow('connection reset')
  })
})
