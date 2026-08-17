import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireUser = vi.fn()
const revalidatePath = vi.fn()

const eventFindUnique = vi.fn()
const categoryFindUnique = vi.fn()
const attendanceUpsert = vi.fn()
const attendanceFindMany = vi.fn()

class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code)
  }
}

vi.mock('@/lib/authz', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
  AuthzError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: {
      findUnique: (...args: unknown[]) => eventFindUnique(...args),
    },
    category: {
      findUnique: (...args: unknown[]) => categoryFindUnique(...args),
    },
    attendanceRecord: {
      upsert: (...args: unknown[]) => attendanceUpsert(...args),
      findMany: (...args: unknown[]) => attendanceFindMany(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

const { saveCount, getEventCounts, getEventSummary } = await import('@/lib/actions/attendance')

const VOLUNTEER = { email: 'vol@example.com', role: 'VOLUNTEER' as const }
const ADMIN = { email: 'admin@example.com', role: 'ADMIN' as const }

beforeEach(() => {
  requireUser.mockReset()
  revalidatePath.mockReset()
  eventFindUnique.mockReset()
  categoryFindUnique.mockReset()
  attendanceUpsert.mockReset()
  attendanceFindMany.mockReset()
})

describe('saveCount', () => {
  it('checks auth before parsing input — an unauthenticated call never reaches validation or the db', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: -5 })).rejects.toThrow(
      AuthzError
    )
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects invalid input even for a signed-in user, before touching the db', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: -1 })).rejects.toThrow()
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects a count above MAX_COUNT', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(
      saveCount({ eventId: 'e1', categoryId: 'c1', count: 100_001 })
    ).rejects.toThrow()
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects when the event is archived', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: true })
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: true })
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects when the event does not exist', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(null)
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: true })
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects when the category is inactive', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: false })
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })).rejects.toThrow(
      'That category is no longer active'
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('rejects when the category does not exist', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    categoryFindUnique.mockResolvedValue(null)
    await expect(saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })).rejects.toThrow(
      'That category is no longer active'
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
  })

  it('always derives recordedBy from the session, ignoring any recordedBy-shaped value the caller supplies', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: true })
    attendanceUpsert.mockResolvedValue({})

    // Attacker tries to smuggle a spoofed recordedBy through the input object.
    const spoofed = {
      eventId: 'e1',
      categoryId: 'c1',
      count: 42,
      recordedBy: 'attacker@evil.com',
    }
    await saveCount(spoofed)

    expect(attendanceUpsert).toHaveBeenCalledWith({
      where: { eventId_categoryId: { eventId: 'e1', categoryId: 'c1' } },
      create: { eventId: 'e1', categoryId: 'c1', count: 42, recordedBy: VOLUNTEER.email },
      update: { count: 42, recordedBy: VOLUNTEER.email },
    })
    // The spoofed value never made it into the write.
    const call = attendanceUpsert.mock.calls[0][0]
    expect(call.create.recordedBy).toBe(VOLUNTEER.email)
    expect(call.update.recordedBy).toBe(VOLUNTEER.email)
    expect(call.create.recordedBy).not.toBe('attacker@evil.com')
  })

  it('uses the eventId_categoryId compound key so a repeat save updates in place instead of duplicating', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: true })
    attendanceUpsert.mockResolvedValue({})

    await saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })
    await saveCount({ eventId: 'e1', categoryId: 'c1', count: 25 })

    expect(attendanceUpsert).toHaveBeenCalledTimes(2)
    for (const call of attendanceUpsert.mock.calls) {
      expect(call[0].where).toEqual({ eventId_categoryId: { eventId: 'e1', categoryId: 'c1' } })
    }
    // Second call carries the corrected count — the upsert `where` guarantees
    // this lands on the same row rather than inserting a second one.
    expect(attendanceUpsert.mock.calls[1][0].update.count).toBe(25)
  })

  it('revalidates the entry and report paths for the affected event on success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    categoryFindUnique.mockResolvedValue({ id: 'c1', isActive: true })
    attendanceUpsert.mockResolvedValue({})

    const result = await saveCount({ eventId: 'e1', categoryId: 'c1', count: 10 })

    expect(revalidatePath).toHaveBeenCalledWith('/entry/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/report/e1')
    expect(result).toEqual({ ok: true })
  })
})

describe('getEventCounts', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(getEventCounts('e1')).rejects.toThrow(AuthzError)
    expect(attendanceFindMany).not.toHaveBeenCalled()
  })

  it('rejects an empty id', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(getEventCounts('')).rejects.toThrow()
    expect(attendanceFindMany).not.toHaveBeenCalled()
  })

  it('returns counts keyed by categoryId', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    attendanceFindMany.mockResolvedValue([
      { categoryId: 'c1', count: 5 },
      { categoryId: 'c2', count: 12 },
    ])
    const result = await getEventCounts('e1')
    expect(result).toEqual({ c1: 5, c2: 12 })
    expect(attendanceFindMany).toHaveBeenCalledWith({ where: { eventId: 'e1' } })
  })
})

describe('getEventSummary', () => {
  const baseEvent = {
    id: 'e1',
    name: 'Sunday Service',
    serviceDate: '2026-08-09',
    records: [
      {
        categoryId: 'c1',
        count: 100,
        recordedBy: 'vol@example.com',
        updatedAt: new Date('2026-08-09T10:00:00Z'),
        category: { name: 'Main Hall', type: 'SECTION', sortOrder: 0, countsTowardTotal: true },
      },
      {
        categoryId: 'c2',
        count: 20,
        recordedBy: 'vol2@example.com',
        updatedAt: new Date('2026-08-09T10:05:00Z'),
        category: { name: 'Kids Room', type: 'CLASSROOM', sortOrder: 1, countsTowardTotal: true },
      },
      {
        categoryId: 'c3',
        count: 5,
        recordedBy: 'vol@example.com',
        updatedAt: new Date('2026-08-09T10:10:00Z'),
        category: { name: 'Salvations', type: 'SERVICE_METRIC', sortOrder: 2, countsTowardTotal: false },
      },
    ],
  }

  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(getEventSummary('e1')).rejects.toThrow(AuthzError)
  })

  it('throws when the event does not exist', async () => {
    requireUser.mockResolvedValue(ADMIN)
    eventFindUnique.mockResolvedValue(null)
    await expect(getEventSummary('e1')).rejects.toThrow('No such service')
  })

  it('hides recordedBy from a volunteer', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(baseEvent)
    const result = await getEventSummary('e1')
    expect(result.rows.every((row) => row.recordedBy === undefined)).toBe(true)
  })

  it('includes recordedBy for an admin', async () => {
    requireUser.mockResolvedValue(ADMIN)
    eventFindUnique.mockResolvedValue(baseEvent)
    const result = await getEventSummary('e1')
    expect(result.rows.find((row) => row.categoryId === 'c1')?.recordedBy).toBe('vol@example.com')
  })

  it('computes totals by category type and a grand total that excludes categories with countsTowardTotal: false', async () => {
    requireUser.mockResolvedValue(ADMIN)
    eventFindUnique.mockResolvedValue(baseEvent)
    const result = await getEventSummary('e1')
    expect(result.totals).toEqual({
      sanctuary: 100,
      classrooms: 20,
      growthTrack: 0,
      serveTeams: 0,
      // 120, not 125 — the Salvations record (a ministry metric) is excluded.
      grand: 120,
    })
  })
})
