'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser, AuthzError } from '@/lib/authz'
import { isUniqueConstraintError } from '@/lib/actions/speakers'
import { createEventSchema, serviceDateSchema, idSchema, friendlyValidationMessage } from '@/lib/validation'
import { todayServiceDate, formatServiceDate } from '@/lib/dates'

export async function listEvents() {
  await requireUser()
  return prisma.event.findMany({
    where: { isArchived: false },
    orderBy: [{ serviceDate: 'desc' }, { name: 'asc' }],
    take: 50,
  })
}

export async function createEvent(input: unknown) {
  await requireAdmin()
  const { name, serviceDate } = createEventSchema.parse(input)

  const event = await prisma.event.create({ data: { name, serviceDate } })
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
 * Volunteers can start counting even if no admin pre-created today's service.
 * Without this, a forgotten setup step blocks the entire Sunday.
 */
export async function getOrCreateTodayEvent() {
  await requireUser()
  const serviceDate = todayServiceDate()
  const name = `Service - ${formatServiceDate(serviceDate)}`

  const existing = await prisma.event.findFirst({
    where: { serviceDate, isArchived: false },
    orderBy: { name: 'asc' },
  })
  if (existing) return existing

  try {
    const event = await prisma.event.create({ data: { name, serviceDate } })
    revalidatePath('/dashboard')
    return event
  } catch (error) {
    // Two volunteers can both pass the findFirst check above and race to
    // create — the compound [serviceDate, name] values are deterministic, so
    // the loser's create fails with P2002, not a real conflict. Re-fetch and
    // return the winner's row instead of surfacing an error page.
    if (!isUniqueConstraintError(error)) throw error
    const winner = await prisma.event.findFirst({
      where: { serviceDate, isArchived: false },
      orderBy: { name: 'asc' },
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
    orderBy: [{ serviceDate: 'asc' }, { name: 'asc' }],
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
    orderBy: [{ serviceDate: 'desc' }, { name: 'asc' }],
    take: 50,
  })
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
