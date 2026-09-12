'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser, AuthzError } from '@/lib/authz'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import {
  createEventSchema,
  serviceDateSchema,
  startTimeSchema,
  updateEventScheduleSchema,
  idSchema,
  friendlyValidationMessage,
} from '@/lib/validation'
import { todayServiceDate, formatServiceDate, formatServiceTime } from '@/lib/dates'

export async function listEvents() {
  await requireUser()
  return prisma.event.findMany({
    where: { isArchived: false },
    orderBy: [{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }],
    take: 50,
  })
}

export async function createEvent(input: unknown) {
  await requireAdmin()
  const { name, serviceDate, startTime } = createEventSchema.parse(input)

  const event = await prisma.event.create({ data: { name, serviceDate, startTime } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  return event
}

export async function archiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: true } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/entry/${id}`)
}

/**
 * Today's non-archived services, in display/selection order. The dashboard
 * uses this to decide which of the three UI states to render (zero / one /
 * many) BEFORE ever calling getOrCreateTodayEvent — see that function's
 * comment for why reaching its >1 case is exceptional rather than normal.
 */
export async function listTodayEvents() {
  await requireUser()
  const serviceDate = todayServiceDate()
  return prisma.event.findMany({
    where: { serviceDate, isArchived: false },
    orderBy: { startTime: 'asc' },
  })
}

/**
 * Volunteers can start counting even if no admin pre-created today's service
 * — but ONLY when there is exactly zero or one service today. Without the
 * zero-service path, a forgotten setup step blocks the entire Sunday.
 *
 * With two or more services today this THROWS rather than guessing. It used
 * to silently pick one via `findFirst(orderBy: name)`, which could route a
 * volunteer into the wrong service's entry screen — and because counts are
 * upserted, silently overwrite that service's numbers. The dashboard now
 * calls listTodayEvents() first and renders one button per service when
 * there's more than one, so a caller only reaches this function's >1 branch
 * via an exceptional path (e.g. a stale tab whose button was rendered before
 * a second service existed, then tapped after). A loud throw is correct
 * there — a discriminated union would just invite a caller to handle a case
 * the UI is supposed to have already resolved.
 *
 * `startTimeInput` is only read on the zero-service (create) path, and only
 * parsed there — via `startTimeSchema`, the same schema every other
 * startTime in this app goes through. There is deliberately no server-side
 * default any more: a missing or malformed value throws a ZodError instead
 * of silently stamping a hardcoded time nobody chose. (A `'09:30'`
 * `defaultValue` still lives in the dashboard's zero-service form — that's a
 * UI convenience for the common case, not a guarantee this function makes.)
 * The one-service branch returns the existing row untouched and never looks
 * at `startTimeInput` — a caller in that branch doesn't need to supply one.
 */
export async function getOrCreateTodayEvent(startTimeInput?: unknown) {
  await requireUser()
  const serviceDate = todayServiceDate()

  const existing = await prisma.event.findMany({
    where: { serviceDate, isArchived: false },
    orderBy: { startTime: 'asc' },
  })
  if (existing.length > 1) {
    throw new Error(
      'Multiple services are scheduled today — choose one from the dashboard instead of guessing.'
    )
  }
  if (existing.length === 1) return existing[0]

  // Only reached when we're actually about to create — see doc comment.
  const startTime = startTimeSchema.parse(startTimeInput)
  const name = `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime(startTime)}`

  try {
    const event = await prisma.event.create({ data: { name, serviceDate, startTime } })
    revalidatePath('/dashboard')
    return event
  } catch (error) {
    // Two volunteers can both pass the check above and race to create — the
    // compound [serviceDate, name] values are deterministic, so the loser's
    // create fails with P2002, not a real conflict. Re-fetch and return the
    // winner's row instead of surfacing an error page. Ordered by startTime
    // (not name) so the winner is deterministic under the new ordering.
    if (!isUniqueConstraintError(error)) throw error
    const winner = await prisma.event.findFirst({
      where: { serviceDate, isArchived: false },
      orderBy: { startTime: 'asc' },
    })
    if (!winner) throw error
    return winner
  }
}

/**
 * Events whose serviceDate falls within [start, end], inclusive. Includes
 * archived events — an export is a historical record, and archiving isn't
 * deletion.
 */
export async function listEventsInRange(start: string, end: string) {
  await requireAdmin()
  const startDate = serviceDateSchema.parse(start)
  const endDate = serviceDateSchema.parse(end)
  if (startDate > endDate) throw new Error('start must not be after end')

  return prisma.event.findMany({
    where: { serviceDate: { gte: startDate, lte: endDate } },
    orderBy: [{ serviceDate: 'asc' }, { startTime: 'asc' }, { name: 'asc' }],
  })
}

/** Symmetric with archiveEvent — a mistaken archive must be reversible from the UI. */
export async function unarchiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: false } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/entry/${id}`)
}

/**
 * Every service, most recent first, INCLUDING archived ones — unlike
 * listEvents() (which powers the volunteer dashboard and hides archived
 * services on purpose). Powers the admin-only Settings "Services" list,
 * where seeing — and un-archiving — a mistakenly archived service is the
 * point.
 */
export async function listRecentEvents() {
  await requireAdmin()
  return prisma.event.findMany({
    orderBy: [{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }],
    take: 50,
  })
}

/**
 * Correct a service's date and time after creation — someone will pick the
 * wrong one, and a service mis-dated by a week needs to be moved rather than
 * recreated (recreating would orphan any counts already entered against it).
 *
 * Date and time move together in one write, so a service can never be left
 * half-moved. The service NAME stays immutable: it is the other half of
 * @@unique([serviceDate, name]) and the key getOrCreateTodayEvent's race
 * recovery re-finds its winner by.
 *
 * Deliberately imposes no "not in the past" rule — correcting a past
 * service's date is the whole reason this exists.
 */
export async function updateEventSchedule(input: unknown) {
  await requireAdmin()
  const { id, serviceDate, startTime } = updateEventScheduleSchema.parse(input)

  const existing = await prisma.event.findUnique({ where: { id } })
  if (!existing) throw new Error('No such service')
  // Same promise the archive confirmation dialog already makes: an archived
  // service stops accepting counts AND edits. Unarchive first.
  if (existing.isArchived) throw new Error('That service is not accepting counts')

  await prisma.event.update({ where: { id }, data: { serviceDate, startTime } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/entry/${id}`)
  revalidatePath(`/report/${id}`)
  // The manage page renders the service date in its own header — deleteCount
  // already revalidates this path for the same reason.
  revalidatePath(`/report/${id}/manage`)
}

export type EventFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around createEvent() for the Settings
 * page's "Create a service" form — same inline-error pattern as
 * createCategoryAction. The @@unique([serviceDate, name]) constraint means
 * a duplicate name on the same date surfaces as P2002.
 */
export async function createEventAction(
  _prevState: EventFormState,
  formData: FormData
): Promise<EventFormState> {
  try {
    await createEvent({
      name: formData.get('name'),
      serviceDate: formData.get('serviceDate'),
      startTime: formData.get('startTime'),
    })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'A service with that name already exists on that date.' }
    }
    throw error
  }
  return { ok: true }
}

/**
 * useActionState-compatible wrapper around updateEventSchedule() — same
 * error ladder as createEventAction. Moving a date is exactly as
 * collision-prone as creating one, so the P2002 branch is not optional here.
 */
export async function updateEventScheduleAction(
  _prevState: EventFormState,
  formData: FormData
): Promise<EventFormState> {
  try {
    await updateEventSchedule({
      id: formData.get('id'),
      serviceDate: formData.get('serviceDate'),
      startTime: formData.get('startTime'),
    })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'A service with that name already exists on that date.' }
    }
    throw error
  }
  return { ok: true }
}
