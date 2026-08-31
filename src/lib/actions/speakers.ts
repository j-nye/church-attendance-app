'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { addSpeakerSchema, removeSpeakerSchema, idSchema } from '@/lib/validation'

export type Speaker = {
  id: string
  name: string
}

/** True when `error` is a Prisma unique-constraint violation (P2002). */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Speakers for the entry screen and report page, in the order they were added. */
export async function listSpeakers(eventId: string): Promise<Speaker[]> {
  await requireUser()
  const id = idSchema.parse(eventId)

  const speakers = await prisma.serviceSpeaker.findMany({
    where: { eventId: id },
    orderBy: { createdAt: 'asc' },
  })
  return speakers.map((speaker) => ({ id: speaker.id, name: speaker.name }))
}

/**
 * Record a name on the stage for a service. A duplicate name for the same
 * event is a friendly no-op, not an error — mirrors the upsert idempotency
 * convention used for counts (a double-tap or a second volunteer adding the
 * same name shouldn't fail).
 */
export async function addSpeaker(input: unknown) {
  const user = await requireUser()
  const { eventId, name } = addSpeakerSchema.parse(input)

  // A valid-looking id is not permission to write to an archived event.
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.isArchived) throw new Error('That service is not accepting counts')

  try {
    // recordedBy comes from the session — never from input.
    await prisma.serviceSpeaker.create({ data: { eventId, name, recordedBy: user.email } })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }

  revalidatePath(`/entry/${eventId}`)
  revalidatePath(`/report/${eventId}`)
  return { ok: true as const }
}

/**
 * Remove a name from a service's speaker list — a low-stakes correction of a
 * list that's re-editable at any time, unlike deleteCount's audited hard
 * delete of a headcount.
 */
export async function removeSpeaker(input: unknown) {
  await requireUser()
  const { eventId, speakerId } = removeSpeakerSchema.parse(input)

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.isArchived) throw new Error('That service is not accepting counts')

  // deleteMany, not delete — scoping by both id AND eventId means a
  // valid-looking speaker id from a different event deletes nothing, and an
  // already-removed speaker (or a double-click race) is a harmless no-op
  // instead of a thrown P2025.
  await prisma.serviceSpeaker.deleteMany({ where: { id: speakerId, eventId } })

  revalidatePath(`/entry/${eventId}`)
  revalidatePath(`/report/${eventId}`)
  return { ok: true as const }
}
