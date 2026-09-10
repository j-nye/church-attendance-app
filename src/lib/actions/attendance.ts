'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser, requireAdmin } from '@/lib/authz'
import { saveCountSchema, deleteCountSchema, idSchema } from '@/lib/validation'
import { TYPE_LABELS } from '@/lib/category-labels'
import { formatServiceTime } from '@/lib/dates'
import { resolveDisplayNames } from '@/lib/display-names'

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
 * Report data.
 *
 * `recordedByName` is shown to EVERY signed-in viewer — volunteer and admin
 * alike. This deliberately reverses this app's earlier rule that attribution
 * was admin-only. The raw `recordedBy` email address stays ADMIN-only exactly
 * as before: the reversal is about surfacing *names*, not about starting to
 * leak colleagues' email addresses into a view a volunteer can open.
 *
 * Names are resolved once per call via resolveDisplayNames() — never once per
 * row — and the null case (no resolvable name) is handled per audience: an
 * admin, who already sees the raw email elsewhere on this same row, falls
 * back to the email; a volunteer falls back to the literal string 'Unknown'.
 * An email-shaped fallback for a volunteer would silently defeat the
 * admin-only rule on `recordedBy` through this new field.
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

  // One batch query for every recorder on this event, not one per row.
  const names = await resolveDisplayNames(event.records.map((record) => record.recordedBy))
  const resolveForAudience = (email: string): string => {
    const resolved = names.get(email) ?? null
    return resolved ?? (user.role === 'ADMIN' ? email : 'Unknown')
  }

  const rows = event.records.map((record) => ({
    categoryId: record.categoryId,
    name: record.category.name,
    type: record.category.type,
    count: record.count,
    recordedBy: user.role === 'ADMIN' ? record.recordedBy : undefined,
    recordedByName: resolveForAudience(record.recordedBy),
    updatedAt: record.updatedAt,
  }))

  // Service-level recorder list, for the report header's "Counts entered
  // by: …" line. Two-stage de-duplication:
  //   1. Collapse by EMAIL first (the identity), in first-recorded order —
  //      two counts entered by the same person yield one entry.
  //   2. Resolve each surviving email to a display string (same per-audience
  //      rule as above) and collapse duplicate STRINGS — otherwise multiple
  //      unresolvable recorders would render as a repeated "Unknown, Unknown".
  // Consequence accepted deliberately: this is a set of names, not a
  // headcount of recorders. Two people who share a display name — or two
  // unresolvable people — appear once.
  const seenEmails = new Set<string>()
  const distinctEmailsInOrder: string[] = []
  for (const record of event.records) {
    if (!seenEmails.has(record.recordedBy)) {
      seenEmails.add(record.recordedBy)
      distinctEmailsInOrder.push(record.recordedBy)
    }
  }
  const seenNames = new Set<string>()
  const recordedByNames: string[] = []
  for (const email of distinctEmailsInOrder) {
    const displayName = resolveForAudience(email)
    if (!seenNames.has(displayName)) {
      seenNames.add(displayName)
      recordedByNames.push(displayName)
    }
  }

  const totalBy = (type: string) =>
    rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.count, 0)

  // Grand total only includes categories marked as real headcounts — a
  // ministry metric like Salvations must never inflate attendance.
  const grand = event.records
    .filter((record) => record.category.countsTowardTotal)
    .reduce((sum, record) => sum + record.count, 0)

  return {
    event: { id: event.id, name: event.name, serviceDate: event.serviceDate, startTime: event.startTime },
    rows,
    recordedByNames,
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
  serviceTime: string
  serviceName: string
  archived: boolean
  categoryType: string
  group: string
  categoryName: string
  count: number | ''
  countsTowardTotal: boolean
  recordedBy: string
  recordedByName: string
}

/**
 * Flattened (event, category) rows for CSV export, across any number of
 * events. Always includes recordedBy unconditionally — unlike
 * getEventSummary's per-row masking, this whole endpoint is admin-only end
 * to end, so there's no volunteer-facing view of this data to protect.
 * recordedByName follows the same admin-only reasoning: an unresolved name
 * falls back to the email itself, never to 'Unknown' — this is not a view a
 * volunteer can reach, so there is no email to hide.
 *
 * Each event's rows are its attendance records, immediately followed by that
 * same event's speakers — additive rows identifiable by
 * `categoryType: 'SPEAKER'`, with an empty-string Count since a speaker
 * isn't a headcount. `ServiceSpeaker.recordedBy` is an email on the identical
 * footing as `AttendanceRecord.recordedBy`, so it gets the same treatment.
 */
export async function getExportRows(eventIds: string[]): Promise<ExportRow[]> {
  await requireAdmin()
  if (eventIds.length === 0) return []

  const [events, speakers] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: eventIds } },
      include: {
        records: {
          include: { category: true },
          orderBy: [{ category: { sortOrder: 'asc' } }, { category: { name: 'asc' } }],
        },
      },
      orderBy: [{ serviceDate: 'asc' }, { startTime: 'asc' }, { name: 'asc' }],
    }),
    prisma.serviceSpeaker.findMany({
      where: { eventId: { in: eventIds } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const speakersByEvent = new Map<string, typeof speakers>()
  for (const speaker of speakers) {
    const list = speakersByEvent.get(speaker.eventId) ?? []
    list.push(speaker)
    speakersByEvent.set(speaker.eventId, list)
  }

  // One batch query for every recorder across every event and speaker in
  // this export — not one per row.
  const allEmails: string[] = []
  for (const event of events) {
    for (const record of event.records) allEmails.push(record.recordedBy)
  }
  for (const speaker of speakers) allEmails.push(speaker.recordedBy)
  const names = await resolveDisplayNames(allEmails)
  // Admin-only end to end (requireAdmin above), so falling back to the email
  // itself for an unresolved name is correct here — unlike getEventSummary.
  const nameFor = (email: string) => names.get(email) ?? email

  return events.flatMap((event) => {
    const attendanceRows: ExportRow[] = event.records.map((record) => ({
      serviceDate: event.serviceDate,
      serviceTime: formatServiceTime(event.startTime),
      serviceName: event.name,
      archived: event.isArchived,
      categoryType: record.category.type,
      group: TYPE_LABELS[record.category.type] ?? record.category.type,
      categoryName: record.category.name,
      count: record.count,
      countsTowardTotal: record.category.countsTowardTotal,
      recordedBy: record.recordedBy,
      recordedByName: nameFor(record.recordedBy),
    }))

    const speakerRows: ExportRow[] = (speakersByEvent.get(event.id) ?? []).map((speaker) => ({
      serviceDate: event.serviceDate,
      serviceTime: formatServiceTime(event.startTime),
      serviceName: event.name,
      archived: event.isArchived,
      categoryType: 'SPEAKER',
      group: 'Stage',
      categoryName: speaker.name,
      count: '',
      countsTowardTotal: false,
      recordedBy: speaker.recordedBy,
      recordedByName: nameFor(speaker.recordedBy),
    }))

    return [...attendanceRows, ...speakerRows]
  })
}

export type ManageRow = {
  categoryId: string
  categoryName: string
  categoryType: string
  count?: number
  recordedBy?: string
  recordedByName?: string
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

  // One batch query for every recorder on this event, not one per row.
  const names = await resolveDisplayNames(records.map((record) => record.recordedBy))
  // Admin-only end to end (requireAdmin above), so falling back to the email
  // itself for an unresolved name is correct here — unlike getEventSummary.
  const nameFor = (email: string) => names.get(email) ?? email

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
      recordedByName: undefined,
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
      recordedByName: nameFor(record.recordedBy),
      updatedAt: record.updatedAt,
    })
  }

  return Array.from(rows.values())
}

/**
 * Hard-deletes a specific record — the one truly irreversible action in an
 * app that otherwise soft-deletes on principle. Reads the existing record
 * inside an interactive transaction; if one exists, writes an AuditLog row
 * and deletes it in that same transaction. If nothing matches (a
 * double-click race, or the record is already gone), it's a silent no-op —
 * no audit row, no error.
 */
export async function deleteCount(input: unknown) {
  const user = await requireAdmin()
  const { eventId, categoryId } = deleteCountSchema.parse(input)

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.isArchived) throw new Error('That service is not accepting counts')

  await prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({
      where: { eventId_categoryId: { eventId, categoryId } },
    })
    if (!existing) return

    // recordedBy/actorEmail come from the session — never from input.
    await tx.auditLog.create({
      data: {
        actorEmail: user.email,
        action: 'DELETE_COUNT',
        eventId,
        categoryId,
        priorCount: existing.count,
      },
    })
    // deleteMany, not delete — a double-click race (already gone by the
    // second click) becomes a harmless no-op instead of a thrown P2025.
    await tx.attendanceRecord.deleteMany({ where: { eventId, categoryId } })
  })

  revalidatePath(`/entry/${eventId}`)
  revalidatePath(`/report/${eventId}`)
  revalidatePath(`/report/${eventId}/manage`)
  return { ok: true as const }
}
