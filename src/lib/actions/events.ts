'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, requireUser } from '@/lib/authz'
import { createEventSchema, serviceDateSchema, idSchema } from '@/lib/validation'
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
  return event
}

export async function archiveEvent(input: unknown) {
  await requireAdmin()
  const id = idSchema.parse(input)

  await prisma.event.update({ where: { id }, data: { isArchived: true } })
  revalidatePath('/dashboard')
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

  const event = await prisma.event.create({ data: { name, serviceDate } })
  revalidatePath('/dashboard')
  return event
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
