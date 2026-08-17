'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { saveCountSchema, idSchema } from '@/lib/validation'

/**
 * Record or correct a headcount. Exactly one row exists per (event, category),
 * so a double-tap or a second volunteer counting the same section overwrites
 * rather than double-counting.
 */
export async function saveCount(input: unknown) {
  const user = await requireUser()
  const { eventId, categoryId, count } = saveCountSchema.parse(input)

  // Validate the referenced rows are real AND usable — a valid-looking id is
  // not permission to write to an archived event or a retired category.
  const [event, category] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.category.findUnique({ where: { id: categoryId } }),
  ])
  if (!event || event.isArchived) throw new Error('That service is not accepting counts')
  if (!category || !category.isActive) throw new Error('That category is no longer active')

  await prisma.attendanceRecord.upsert({
    where: { eventId_categoryId: { eventId, categoryId } },
    // recordedBy comes from the session — never from input.
    create: { eventId, categoryId, count, recordedBy: user.email },
    update: { count, recordedBy: user.email },
  })

  revalidatePath(`/entry/${eventId}`)
  revalidatePath(`/report/${eventId}`)
  return { ok: true as const }
}

/** Counts for the entry screen, keyed by categoryId. */
export async function getEventCounts(eventId: string) {
  await requireUser()
  const id = idSchema.parse(eventId)

  const records = await prisma.attendanceRecord.findMany({ where: { eventId: id } })
  return Object.fromEntries(records.map((record) => [record.categoryId, record.count]))
}

/**
 * Report data. `recordedBy` is included only for admins — volunteer email
 * addresses should not leak into a view a volunteer can open.
 */
export async function getEventSummary(eventId: string) {
  const user = await requireUser()
  const id = idSchema.parse(eventId)

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      records: { include: { category: true }, orderBy: { category: { sortOrder: 'asc' } } },
    },
  })
  if (!event) throw new Error('No such service')

  const rows = event.records.map((record) => ({
    categoryId: record.categoryId,
    name: record.category.name,
    type: record.category.type,
    count: record.count,
    recordedBy: user.role === 'ADMIN' ? record.recordedBy : undefined,
    updatedAt: record.updatedAt,
  }))

  const totalBy = (type: string) =>
    rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.count, 0)

  // Grand total only includes categories marked as real headcounts — a
  // ministry metric like Salvations must never inflate attendance.
  const grand = event.records
    .filter((record) => record.category.countsTowardTotal)
    .reduce((sum, record) => sum + record.count, 0)

  return {
    event: { id: event.id, name: event.name, serviceDate: event.serviceDate },
    rows,
    totals: {
      sanctuary: totalBy('SECTION'),
      classrooms: totalBy('CLASSROOM'),
      growthTrack: totalBy('GROWTH_TRACK'),
      serveTeams: totalBy('SERVE_TEAM'),
      grand,
    },
  }
}
