import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import {
  todayServiceDate,
  formatServiceDate,
  formatServiceTime,
  shiftServiceDate,
  SERVICE_DATE_PAST_DAYS,
  SERVICE_DATE_FUTURE_DAYS,
} from '@/lib/dates'

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
  addService,
  addNamedService,
  addServiceAction,
  addNamedServiceAction,
  markCountingDone,
  reopenCounting,
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

const VOLUNTEER = { email: 'vol@example.com', role: 'VOLUNTEER' as const }
const ADMIN = { email: 'admin@example.com', role: 'ADMIN' as const }

function collisionRow(overrides: Partial<{
  id: string
  name: string
  serviceDate: string
  startTime: string
  isArchived: boolean
  isCountingDone: boolean
}> = {}) {
  const serviceDate = overrides.serviceDate ?? todayServiceDate()
  return {
    id: 'existing1',
    name: `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`,
    serviceDate,
    startTime: '11:00',
    isArchived: false,
    ...overrides,
  }
}

// One day outside each edge of the VOLUNTEER window — used by the paired
// authorization/admin-exemption tests below for both addService and
// addNamedService.
const TOO_FAR_FUTURE = shiftServiceDate(todayServiceDate(), SERVICE_DATE_FUTURE_DAYS + 1)
const TOO_FAR_PAST = shiftServiceDate(todayServiceDate(), -(SERVICE_DATE_PAST_DAYS + 1))
const OUT_OF_WINDOW_CASES: Array<[string, string]> = [
  ['one day past the future edge', TOO_FAR_FUTURE],
  ['one day past the past edge', TOO_FAR_PAST],
]

describe('addService', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(
      addService({ serviceDate: todayServiceDate(), startTime: '11:00' })
    ).rejects.toThrow(AuthzError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('allows a VOLUNTEER to add a service — requireAdmin is never called in this flow', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockResolvedValue({ id: 'new', startTime: '11:00' })
    await addService({ serviceDate: todayServiceDate(), startTime: '11:00' })
    expect(requireAdmin).not.toHaveBeenCalled()
  })

  // THE LOAD-BEARING AUTHORIZATION TEST: a VOLUNTEER's serviceDate is bounded
  // to a rolling window (SERVICE_DATE_PAST_DAYS back, SERVICE_DATE_FUTURE_DAYS
  // ahead) — this bound is what justifies requireUser() instead of
  // requireAdmin() here (see addService's doc comment). A date one day
  // outside the window on either side must be rejected before ever touching
  // the database.
  it.each(OUT_OF_WINDOW_CASES)(
    'rejects a serviceDate outside the allowed window for a VOLUNTEER — this bound is what justifies requireUser() instead of requireAdmin() (%s)',
    async (_label, serviceDate) => {
      requireUser.mockResolvedValue(VOLUNTEER)
      await expect(addService({ serviceDate, startTime: '11:00' })).rejects.toThrow(ZodError)
      expect(eventCreate).not.toHaveBeenCalled()
    }
  )

  // THE PAIRED ADMIN-EXEMPTION TEST: the exact same out-of-window dates are
  // ACCEPTED for an ADMIN — the other half of the authorization contract.
  // Without this test, the admin exemption is unverified.
  it.each(OUT_OF_WINDOW_CASES)(
    'accepts the same out-of-window serviceDate for an ADMIN (%s)',
    async (_label, serviceDate) => {
      requireUser.mockResolvedValue(ADMIN)
      const name = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
      eventCreate.mockResolvedValue({ id: 'new', name, serviceDate, startTime: '11:00' })

      await expect(
        addService({ serviceDate, startTime: '11:00' })
      ).resolves.toMatchObject({ status: 'created' })
      expect(eventCreate).toHaveBeenCalledWith({ data: { name, serviceDate, startTime: '11:00' } })
    }
  )

  it.each([['VOLUNTEER', VOLUNTEER], ['ADMIN', ADMIN]] as const)(
    'rejects a malformed serviceDate regardless of role (%s)',
    async (_label, user) => {
      requireUser.mockResolvedValue(user)
      await expect(addService({ serviceDate: 'not-a-date', startTime: '11:00' })).rejects.toThrow(ZodError)
      await expect(addService({ serviceDate: '2026-13-45', startTime: '11:00' })).rejects.toThrow(ZodError)
      expect(eventCreate).not.toHaveBeenCalled()
    }
  )

  // Security assertion: even when the input carries extra fields (a
  // smuggled role override, a smuggled recordedBy), only the schema's three
  // declared fields reach the create call — proven with an exact (not
  // objectContaining) match.
  it('creates with only the declared fields, even when the input carries extra unexpected fields', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const serviceDate = todayServiceDate()
    const expectedName = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
    eventCreate.mockResolvedValue({ id: 'new', name: expectedName, serviceDate, startTime: '11:00' })

    await addService({
      serviceDate,
      startTime: '11:00',
      role: 'ADMIN',
      recordedBy: 'sneaky@example.com',
    })

    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: expectedName, serviceDate, startTime: '11:00' },
    })
  })

  it('rejects a missing startTime — ZodError, create never called', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(addService({ serviceDate: todayServiceDate() })).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects a malformed startTime — ZodError, create never called', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(
      addService({ serviceDate: todayServiceDate(), startTime: '9:30 AM' })
    ).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('creates the service using the derived "Service - <date> <time>" name and returns a created result', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const serviceDate = todayServiceDate()
    const expectedName = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
    eventCreate.mockResolvedValue({ id: 'new', name: expectedName, serviceDate, startTime: '11:00' })

    const result = await addService({ serviceDate, startTime: '11:00' })

    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: expectedName, serviceDate, startTime: '11:00' },
    })
    expect(result).toEqual({
      status: 'created',
      event: { id: 'new', name: expectedName, serviceDate, startTime: '11:00' },
    })
  })

  // NEW COVERAGE: the whole point of this feature is a caller-chosen date —
  // the derived name and the collision lookup must both key on that SUPPLIED
  // date, not on today's.
  it('derives the name from a non-today serviceDate and keys the collision lookup on that same date', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const serviceDate = shiftServiceDate(todayServiceDate(), 3)
    const expectedName = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )
    eventFindUnique.mockResolvedValue(collisionRow({ serviceDate, name: expectedName, startTime: '11:00' }))

    const result = await addService({ serviceDate, startTime: '11:00' })

    expect(eventFindUnique).toHaveBeenCalledWith({
      where: { serviceDate_name: { serviceDate, name: expectedName } },
    })
    expect(result).toEqual({
      status: 'collision',
      existing: expect.objectContaining({ serviceDate }),
    })
  })

  it('returns a collision result on P2002 instead of throwing, using the serviceDate_name lookup, and never retries create', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const serviceDate = todayServiceDate()
    const expectedName = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )
    eventFindUnique.mockResolvedValue(collisionRow({ name: expectedName, startTime: '11:00' }))

    const result = await addService({ serviceDate, startTime: '11:00' })

    expect(eventFindUnique).toHaveBeenCalledWith({
      where: { serviceDate_name: { serviceDate, name: expectedName } },
    })
    expect(eventCreate).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      status: 'collision',
      existing: { id: 'existing1', name: expectedName, serviceDate, startTime: '11:00', isArchived: false },
    })
  })

  it('surfaces an archived existing service in the collision result rather than throwing', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )
    eventFindUnique.mockResolvedValue(collisionRow({ isArchived: true }))

    const result = await addService({ serviceDate: todayServiceDate(), startTime: '11:00' })

    expect(result.status).toBe('collision')
    expect(result).toEqual(
      expect.objectContaining({ existing: expect.objectContaining({ isArchived: true }) })
    )
  })

  it('rethrows the original P2002 when the re-fetch after a collision finds nothing (should be unreachable)', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`serviceDate`,`name`)',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['serviceDate', 'name'] } }
    )
    eventCreate.mockRejectedValue(p2002)
    eventFindUnique.mockResolvedValue(null)

    await expect(addService({ serviceDate: todayServiceDate(), startTime: '11:00' })).rejects.toBe(p2002)
  })

  it('propagates a non-P2002 create error unchanged', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockRejectedValue(new Error('connection reset'))
    await expect(
      addService({ serviceDate: todayServiceDate(), startTime: '11:00' })
    ).rejects.toThrow('connection reset')
  })

  it('revalidates /dashboard and /settings when a service is created', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockResolvedValue({ id: 'new', startTime: '11:00' })
    await addService({ serviceDate: todayServiceDate(), startTime: '11:00' })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('does not revalidate anything on the collision path, since nothing was written', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )
    eventFindUnique.mockResolvedValue(collisionRow())

    await addService({ serviceDate: todayServiceDate(), startTime: '11:00' })

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('addNamedService', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    ).rejects.toThrow(AuthzError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('allows a VOLUNTEER — requireAdmin is never called in this flow', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockResolvedValue({ id: 'new' })
    await addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    expect(requireAdmin).not.toHaveBeenCalled()
  })

  // Same authorization contract as addService — asserted here too so the
  // named-collision path can't be used to route around the VOLUNTEER window.
  it.each(OUT_OF_WINDOW_CASES)(
    'rejects a serviceDate outside the allowed window for a VOLUNTEER — this bound is what justifies requireUser() instead of requireAdmin() (%s)',
    async (_label, serviceDate) => {
      requireUser.mockResolvedValue(VOLUNTEER)
      await expect(
        addNamedService({ serviceDate, startTime: '11:00', name: 'Spanish Service' })
      ).rejects.toThrow(ZodError)
      expect(eventCreate).not.toHaveBeenCalled()
    }
  )

  it.each(OUT_OF_WINDOW_CASES)(
    'accepts the same out-of-window serviceDate for an ADMIN (%s)',
    async (_label, serviceDate) => {
      requireUser.mockResolvedValue(ADMIN)
      eventFindUnique.mockResolvedValue(collisionRow({ serviceDate }))
      eventCreate.mockResolvedValue({ id: 'new', serviceDate })

      await expect(
        addNamedService({ serviceDate, startTime: '11:00', name: 'Spanish Service' })
      ).resolves.toMatchObject({ id: 'new' })
      expect(eventCreate).toHaveBeenCalledWith({
        data: { name: 'Spanish Service', serviceDate, startTime: '11:00' },
      })
    }
  )

  it.each([['VOLUNTEER', VOLUNTEER], ['ADMIN', ADMIN]] as const)(
    'rejects a malformed serviceDate regardless of role (%s)',
    async (_label, user) => {
      requireUser.mockResolvedValue(user)
      await expect(
        addNamedService({ serviceDate: 'not-a-date', startTime: '11:00', name: 'Spanish Service' })
      ).rejects.toThrow(ZodError)
      expect(eventCreate).not.toHaveBeenCalled()
    }
  )

  it('creates with only the declared fields, even when the input carries extra unexpected fields', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockResolvedValue({ id: 'new' })

    await addNamedService({
      serviceDate: todayServiceDate(),
      startTime: '11:00',
      name: 'Spanish Service',
      role: 'ADMIN',
      recordedBy: 'sneaky@example.com',
    })

    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Spanish Service', serviceDate: todayServiceDate(), startTime: '11:00' },
    })
  })

  it('creates with the supplied name verbatim (trimmed), not the derived auto name', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockResolvedValue({ id: 'new' })

    await addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: '  Spanish Service  ' })

    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Spanish Service', serviceDate: todayServiceDate(), startTime: '11:00' },
    })
  })

  // NEW COVERAGE: the auto-named collision check keys on the SUPPLIED date,
  // not today — and the resulting create uses that same date.
  it('keys the collision check on a non-today serviceDate and creates against that same date', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    const serviceDate = shiftServiceDate(todayServiceDate(), 3)
    const autoName = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime('11:00')}`
    eventFindUnique.mockResolvedValue(collisionRow({ serviceDate, name: autoName, startTime: '11:00' }))
    eventCreate.mockResolvedValue({ id: 'new' })

    await addNamedService({ serviceDate, startTime: '11:00', name: 'Spanish Service' })

    expect(eventFindUnique).toHaveBeenCalledWith({
      where: { serviceDate_name: { serviceDate, name: autoName } },
    })
    expect(eventCreate).toHaveBeenCalledWith({
      data: { name: 'Spanish Service', serviceDate, startTime: '11:00' },
    })
  })

  it('rejects a blank name — ZodError, create never called', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: '   ' })
    ).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects a name over the length cap — ZodError, create never called', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'x'.repeat(81) })
    ).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rejects a malformed startTime — ZodError, create never called', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00 AM', name: 'Spanish Service' })
    ).rejects.toThrow(ZodError)
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('refuses to create when no matching auto-named collision exists for that date and time', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(null)

    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    ).rejects.toThrow('There is no service at that time on that date to distinguish this from.')
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('lets a P2002 on the named create propagate unchanged (the wrapper maps it, not this function)', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    await expect(
      addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('revalidates /dashboard and /settings on success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockResolvedValue({ id: 'new' })

    await addNamedService({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })
})

describe('addServiceAction', () => {
  it('returns { ok: true, eventId } when a service is created', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockResolvedValue({ id: 'new1', startTime: '11:00' })

    const result = await addServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00' })
    )

    expect(result).toEqual({ ok: true, eventId: 'new1' })
  })

  it('returns { ok: true, collision } with no eventId when the date/time collides with an existing service', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )
    const existing = collisionRow()
    eventFindUnique.mockResolvedValue(existing)

    const result = await addServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00' })
    )

    expect(result).toEqual({
      ok: true,
      collision: {
        id: existing.id,
        name: existing.name,
        serviceDate: existing.serviceDate,
        startTime: existing.startTime,
        isArchived: existing.isArchived,
      },
    })
    expect(result.eventId).toBeUndefined()
  })

  it('returns a friendly inline message when the session is no longer authorized', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))

    const result = await addServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // CHANGED CONTRACT: addService now parses startTime as a field of an
  // object schema ({ serviceDate, startTime }) rather than a bare value (the
  // old addTodayEvent parsed startTimeInput directly via startTimeSchema).
  // The resulting ZodError now carries a field path, so
  // friendlyValidationMessage reports the specific "Service time" label
  // instead of falling back to the generic "That field is not valid."
  it('returns a friendly inline message naming the field for a malformed startTime instead of throwing', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)

    const result = await addServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00 AM' })
    )

    expect(result).toEqual({ ok: false, message: 'Service time is not valid.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // NEW COVERAGE: the out-of-window bound is reachable through the FormData
  // wrapper too, and surfaces via friendlyValidationMessage's new 'custom'
  // case rather than degrading to a generic message.
  it('returns the friendly out-of-window message for a VOLUNTEER instead of throwing', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)

    const result = await addServiceAction(
      { ok: true },
      eventFormData({ serviceDate: TOO_FAR_FUTURE, startTime: '11:00' })
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/too far out/)
    expect(eventCreate).not.toHaveBeenCalled()
  })
})

describe('addNamedServiceAction', () => {
  it('returns { ok: true, eventId } on success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockResolvedValue({ id: 'named1' })

    const result = await addNamedServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    )

    expect(result).toEqual({ ok: true, eventId: 'named1' })
  })

  it('returns a friendly inline message for a duplicate name instead of crashing', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())
    eventCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`serviceDate`,`name`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['serviceDate', 'name'] },
      })
    )

    const result = await addNamedServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    )

    expect(result).toEqual({ ok: false, message: 'A service with that name already exists on that date.' })
  })

  it('returns a friendly inline message when the session is no longer authorized', async () => {
    requireUser.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await addNamedServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  // Regression test: name is a field of an object schema (via .extend()), so
  // its ZodError preserves the `name` field path instead of degrading to a
  // generic "That field is required."
  it('returns exactly "Name is required." for a blank name, not a generic fallback', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(collisionRow())

    const result = await addNamedServiceAction(
      { ok: true },
      eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00', name: '   ' })
    )

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('rethrows the "no collision to distinguish from" guard error rather than mapping it to a friendly message', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(null)

    await expect(
      addNamedServiceAction(
        { ok: true },
        eventFormData({ serviceDate: todayServiceDate(), startTime: '11:00', name: 'Spanish Service' })
      )
    ).rejects.toThrow('There is no service at that time on that date to distinguish this from.')
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

describe('markCountingDone', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(markCountingDone('id1')).rejects.toThrow(AuthzError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed/missing id via idSchema before touching the database', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    await expect(markCountingDone('')).rejects.toThrow(ZodError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('throws "No such service" for a nonexistent id', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue(null)

    await expect(markCountingDone('missing')).rejects.toThrow('No such service')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('refuses an archived service', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: true })

    await expect(markCountingDone('id1')).rejects.toThrow('That service is not accepting counts')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('marks counting done and revalidates exactly dashboard, its own entry page, and settings', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    await markCountingDone('id1')

    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isCountingDone: true } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledTimes(3)
  })
})

describe('reopenCounting', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(reopenCounting('id1')).rejects.toThrow(AuthzError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed/missing id via idSchema before touching the database', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    await expect(reopenCounting('')).rejects.toThrow(ZodError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('throws "No such service" for a nonexistent id', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue(null)

    await expect(reopenCounting('missing')).rejects.toThrow('No such service')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('refuses an archived service', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: true })

    await expect(reopenCounting('id1')).rejects.toThrow('That service is not accepting counts')
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('reopens counting and revalidates exactly dashboard, its own entry page, and settings', async () => {
    requireUser.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER' })
    eventFindUnique.mockResolvedValue({ id: 'id1', isArchived: false })

    await reopenCounting('id1')

    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'id1' }, data: { isCountingDone: false } })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/entry/id1')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledTimes(3)
  })
})
