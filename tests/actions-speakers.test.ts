import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const requireUser = vi.fn()
const revalidatePath = vi.fn()

const eventFindUnique = vi.fn()
const speakerFindMany = vi.fn()
const speakerCreate = vi.fn()
const speakerDeleteMany = vi.fn()

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
    serviceSpeaker: {
      findMany: (...args: unknown[]) => speakerFindMany(...args),
      create: (...args: unknown[]) => speakerCreate(...args),
      deleteMany: (...args: unknown[]) => speakerDeleteMany(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

const { listSpeakers, addSpeaker, removeSpeaker } = await import('@/lib/actions/speakers')

const VOLUNTEER = { email: 'vol@example.com', role: 'VOLUNTEER' as const }

beforeEach(() => {
  requireUser.mockReset()
  revalidatePath.mockReset()
  eventFindUnique.mockReset()
  speakerFindMany.mockReset()
  speakerCreate.mockReset()
  speakerDeleteMany.mockReset()
})

describe('listSpeakers', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(listSpeakers('e1')).rejects.toThrow(AuthzError)
    expect(speakerFindMany).not.toHaveBeenCalled()
  })

  it('rejects an empty id', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(listSpeakers('')).rejects.toThrow()
    expect(speakerFindMany).not.toHaveBeenCalled()
  })

  it('returns speakers ordered by createdAt asc, reduced to id and name', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    speakerFindMany.mockResolvedValue([
      {
        id: 's1',
        eventId: 'e1',
        name: 'Pastor Jones',
        recordedBy: 'vol@example.com',
        createdAt: new Date('2026-08-09T10:00:00Z'),
      },
      {
        id: 's2',
        eventId: 'e1',
        name: 'Guest Speaker',
        recordedBy: 'vol@example.com',
        createdAt: new Date('2026-08-09T10:05:00Z'),
      },
    ])

    const result = await listSpeakers('e1')

    expect(result).toEqual([
      { id: 's1', name: 'Pastor Jones' },
      { id: 's2', name: 'Guest Speaker' },
    ])
    expect(speakerFindMany).toHaveBeenCalledWith({
      where: { eventId: 'e1' },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('addSpeaker', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })).rejects.toThrow(AuthzError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(speakerCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid input before touching the db', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    await expect(addSpeaker({ eventId: 'e1', name: '   ' })).rejects.toThrow()
    expect(eventFindUnique).not.toHaveBeenCalled()
  })

  it('rejects when the event is archived', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: true })
    await expect(addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(speakerCreate).not.toHaveBeenCalled()
  })

  it('rejects when the event does not exist', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(null)
    await expect(addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(speakerCreate).not.toHaveBeenCalled()
  })

  it('creates the speaker with a trimmed name and session-derived recordedBy', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerCreate.mockResolvedValue({})

    const result = await addSpeaker({ eventId: 'e1', name: '  Pastor Jones  ' })

    expect(speakerCreate).toHaveBeenCalledWith({
      data: { eventId: 'e1', name: 'Pastor Jones', recordedBy: VOLUNTEER.email },
    })
    expect(result).toEqual({ ok: true })
  })

  it('treats a P2002 unique-constraint violation (duplicate name for this event) as success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    // Raise the real Prisma error class the way the generated client does —
    // not a plain object with a `.code` property — so addSpeaker's own
    // instanceof/code check is what's under test, not a stand-in for it.
    speakerCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`eventId`,`name`)',
        { code: 'P2002', clientVersion: '6.19.3' }
      )
    )

    const result = await addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })

    expect(result).toEqual({ ok: true })
  })

  it('rethrows a Prisma error that is not P2002', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Some other failure', {
        code: 'P2025',
        clientVersion: '6.19.3',
      })
    )

    await expect(addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })).rejects.toThrow('Some other failure')
  })

  it('rethrows a non-Prisma error untouched', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerCreate.mockRejectedValue(new Error('connection lost'))

    await expect(addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })).rejects.toThrow('connection lost')
  })

  it('revalidates the entry and report paths for the affected event on success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerCreate.mockResolvedValue({})

    await addSpeaker({ eventId: 'e1', name: 'Pastor Jones' })

    expect(revalidatePath).toHaveBeenCalledWith('/entry/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/report/e1')
  })
})

describe('removeSpeaker', () => {
  it('requires a signed-in user', async () => {
    requireUser.mockRejectedValue(new AuthzError('UNAUTHENTICATED'))
    await expect(removeSpeaker({ eventId: 'e1', speakerId: 's1' })).rejects.toThrow(AuthzError)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(speakerDeleteMany).not.toHaveBeenCalled()
  })

  it('rejects when the event is archived', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: true })
    await expect(removeSpeaker({ eventId: 'e1', speakerId: 's1' })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(speakerDeleteMany).not.toHaveBeenCalled()
  })

  it('rejects when the event does not exist', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue(null)
    await expect(removeSpeaker({ eventId: 'e1', speakerId: 's1' })).rejects.toThrow(
      'That service is not accepting counts'
    )
    expect(speakerDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes scoped by both id and eventId, so a valid-looking id from another event deletes nothing', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerDeleteMany.mockResolvedValue({ count: 1 })

    const result = await removeSpeaker({ eventId: 'e1', speakerId: 's1' })

    expect(speakerDeleteMany).toHaveBeenCalledWith({ where: { id: 's1', eventId: 'e1' } })
    expect(result).toEqual({ ok: true })
  })

  it('tolerates zero matches as a harmless no-op', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerDeleteMany.mockResolvedValue({ count: 0 })

    const result = await removeSpeaker({ eventId: 'e1', speakerId: 'already-gone' })

    expect(result).toEqual({ ok: true })
  })

  it('revalidates the entry and report paths for the affected event on success', async () => {
    requireUser.mockResolvedValue(VOLUNTEER)
    eventFindUnique.mockResolvedValue({ id: 'e1', isArchived: false })
    speakerDeleteMany.mockResolvedValue({ count: 1 })

    await removeSpeaker({ eventId: 'e1', speakerId: 's1' })

    expect(revalidatePath).toHaveBeenCalledWith('/entry/e1')
    expect(revalidatePath).toHaveBeenCalledWith('/report/e1')
  })
})
