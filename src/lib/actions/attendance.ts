'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser, requireAdmin } from '@/lib/authz'
import { saveCountSchema, idSchema } from '@/lib/validation'
import { TYPE_LABELS } from '@/lib/category-labels'

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
      records: {
        include: { category: true },
        orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }],
      },
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

export type ExportRow = {
  serviceDate: string
  serviceName: string
  archived: boolean
  categoryType: string
  group: string
  categoryName: string
  count: number
  countsTowardTotal: boolean
  recordedBy: string
}

/**
 * Flattened (event, category) rows for CSV export, across any number of
 * events. Always includes recordedBy unconditionally — unlike
 * getEventSummary's per-row masking, this whole endpoint is admin-only end
 * to end, so there's no volunteer-facing view of this data to protect.
 */
export async function getExportRows(eventIds: string[]): Promise<ExportRow[]> {
  await requireAdmin()
  if (eventIds.length === 0) return []

  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    include: {
      records: {
        include: { category: true },
        orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }],
      },
    },
    orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
  })

  return events.flatMap((event) =>
    event.records.map((record) => ({
      serviceDate: event.serviceDate,
      serviceName: event.name,
      archived: event.isArchived,
      categoryType: record.category.type,
      group: TYPE_LABELS[record.category.type] ?? record.category.type,
      categoryName: record.category.name,
      count: record.count,
      countsTowardTotal: record.category.countsTowardTotal,
      recordedBy: record.recordedBy,
    }))
  )
}

export type ManageRow = {
  categoryId: string
  categoryName: string
  categoryType: string
  count?: number
  recordedBy?: string
  updatedAt?: Date
}

/**
 * One row per category relevant to this service: every active category
 * (mirrors what the entry screen shows) UNIONED with any category that has
 * an existing record here even if it's since been retired — otherwise a
 * stray record tied to a retired category would be invisible to the one
 * page built to find and clean it up.
 */
export async function getManageRows(eventId: string): Promise<ManageRow[]> {
  await requireAdmin()
  const id = idSchema.parse(eventId)

  const [categories, records] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.attendanceRecord.findMany({
      where: { eventId: id },
      include: { category: true },
    }),
  ])

  // A Map preserves insertion order and re-setting an existing key updates
  // its value in place without moving it — so an active category that also
  // has a record stays at its original (sorted) position, and a retired
  // category with a record is appended at the end.
  const rows = new Map<string, ManageRow>()
  for (const category of categories) {
    rows.set(category.id, {
      categoryId: category.id,
      categoryName: category.name,
      categoryType: category.type,
      count: undefined,
      recordedBy: undefined,
      updatedAt: undefined,
    })
  }
  for (const record of records) {
    rows.set(record.categoryId, {
      categoryId: record.categoryId,
      categoryName: record.category.name,
      categoryType: record.category.type,
      count: record.count,
      recordedBy: record.recordedBy,
      updatedAt: record.updatedAt,
    })
  }

  return Array.from(rows.values())
}
