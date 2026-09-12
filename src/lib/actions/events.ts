'use server'

import { revalidatePath } from 'next/cache'
import { Prisma, type Event } from '@prisma/client'
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
  addServiceSchemaByRole,
  addNamedServiceSchemaByRole,
} from '@/lib/validation'
import { todayServiceDate, formatServiceDate, formatServiceTime } from '@/lib/dates'

/**
 * Same derived-name convention getOrCreateTodayEvent uses for its own
 * zero-service create. Deliberately NOT exported: this file has `'use
 * server'` at the top, which means Next.js requires every export to be an
 * async Server Action — a stray synchronous export here breaks Turbopack's
 * dev build in a way nothing else catches (see src/lib/prisma-errors.ts for
 * why that helper lives outside this file instead of being a sibling export).
 */
function autoServiceName(serviceDate: string, startTime: string): string {
  return `Service - ${formatServiceDate(serviceDate)} ${formatServiceTime(startTime)}`
}

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
 * The dashboard now only calls this function in the genuinely-zero-services
 * case (see src/app/dashboard/page.tsx's `pending` partition) — once a done
 * service (isCountingDone) exists alongside a pending one, the dashboard
 * routes directly to the pending service's known id instead of calling this
 * function, precisely because this function's own queries below stay
 * unfiltered on isCountingDone (see next paragraph) and would otherwise
 * throw a spurious ">1 services" error for what the volunteer sees as one
 * remaining service to start. A done service does not change this
 * function's own behavior at all.
 *
 * This function's `findMany`/P2002-recovery `findFirst` queries are
 * deliberately NOT filtered on isCountingDone — they answer "does today have
 * a live (non-archived) service at all", and marking a service done doesn't
 * remove it from that universe. Filtering here would let a done service
 * become invisible to this "any live service today" check while the
 * dashboard's zero-service branch is what decides to call this function in
 * the first place — see src/app/dashboard/page.tsx for the full reasoning.
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

export type ServiceCollision = {
  id: string
  name: string
  serviceDate: string
  startTime: string
  isArchived: boolean
  isCountingDone: boolean
}

export type AddServiceResult =
  | { status: 'created'; event: Event }
  | { status: 'collision'; existing: ServiceCollision }

/**
 * Add an ADDITIONAL service — the volunteer-reachable counterpart to the
 * admin-only createEvent(). Any signed-in user may call this, but a
 * VOLUNTEER's serviceDate is bounded to a rolling window
 * (addServiceSchemaByRole) — that bound is what justifies requireUser()
 * instead of requireAdmin() here: the blast radius of a mistake stays inside
 * a window the volunteer can see and act within. An ADMIN gets no
 * server-side bound at all, matching their existing unrestricted access via
 * createEvent()/Settings — an admin who mis-dates a service can already fix
 * it themselves via updateEventSchedule/archiveEvent, so the bound has
 * nothing to buy them.
 *
 * The role used to select the schema comes from requireUser(), which
 * re-reads the Allowlist on every call — it is never accepted from the
 * client (no hidden role field, nothing echoed back through FormData).
 *
 * Two real services can legitimately land on the same clock time by
 * coincidence, so a collision on the derived [serviceDate, name] key is NOT
 * an error here — it's ambiguous, and only a human present can resolve it.
 * Unlike getOrCreateTodayEvent (where the dashboard resolves ambiguity
 * BEFORE ever calling it, by listing services first), this function can't
 * ask the caller anything before making the write attempt — so instead of
 * guessing whether the collision means "same service, go there" or "a
 * second, different service happens to share a time", it returns a
 * discriminated result and lets the UI ask the volunteer directly.
 * addNamedService is the continuation once they've answered "different".
 */
export async function addService(input: unknown): Promise<AddServiceResult> {
  const user = await requireUser()
  const { serviceDate, startTime } = addServiceSchemaByRole[user.role].parse(input)
  const name = autoServiceName(serviceDate, startTime)

  try {
    const event = await prisma.event.create({ data: { name, serviceDate, startTime } })
    revalidatePath('/dashboard')
    revalidatePath('/settings')
    return { status: 'created', event }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    // Nothing was written on this path — don't revalidate.
    const existing = await prisma.event.findUnique({
      where: { serviceDate_name: { serviceDate, name } },
    })
    // Should be unreachable (the create just failed on this exact key), but
    // don't swallow the original error if it somehow happens.
    if (!existing) throw error
    return {
      status: 'collision',
      existing: {
        id: existing.id,
        name: existing.name,
        serviceDate: existing.serviceDate,
        startTime: existing.startTime,
        isArchived: existing.isArchived,
        isCountingDone: existing.isCountingDone,
      },
    }
  }
}

/**
 * The continuation of addService once a human has confirmed "this is a
 * genuinely different service" in response to a collision. Takes a
 * caller-supplied name instead of the derived one, so two same-time services
 * on the same date can coexist under distinct names.
 *
 * The server-side re-check below (that a matching auto-named collision
 * actually exists) is deliberate, not defensive filler: without it, this
 * function would let a free-text name be created for ANY serviceDate/
 * startTime pair, with no real collision behind it — reopening exactly the
 * "two plausible same-time services" ambiguity the auto-naming rule exists
 * to prevent, reachable by calling this Server Action directly instead of
 * through the UI's collision step.
 */
export async function addNamedService(input: unknown) {
  const user = await requireUser()
  const { serviceDate, startTime, name } = addNamedServiceSchemaByRole[user.role].parse(input)

  const collision = await prisma.event.findUnique({
    where: { serviceDate_name: { serviceDate, name: autoServiceName(serviceDate, startTime) } },
  })
  if (!collision) {
    throw new Error('There is no service at that time on that date to distinguish this from.')
  }

  const event = await prisma.event.create({ data: { name, serviceDate, startTime } })
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  return event
}

export type AddServiceFormState = {
  ok: boolean
  message?: string
  eventId?: string
  collision?: ServiceCollision
}

/**
 * useActionState-compatible wrapper around addService(). No P2002 branch
 * here (unlike addNamedServiceAction below) — a collision on this path is
 * never an error, it's already surfaced as the `collision` result the UI
 * asks the volunteer about.
 */
export async function addServiceAction(
  _prevState: AddServiceFormState,
  formData: FormData
): Promise<AddServiceFormState> {
  try {
    const result = await addService({
      serviceDate: formData.get('serviceDate'),
      startTime: formData.get('startTime'),
    })
    if (result.status === 'collision') {
      return { ok: true, collision: result.existing }
    }
    return { ok: true, eventId: result.event.id }
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    throw error
  }
}

/**
 * useActionState-compatible wrapper around addNamedService(). Unlike
 * addServiceAction, this one DOES need a P2002 branch: the plain path's
 * collision is consumed by addService's discriminated result before it
 * can ever reach a P2002 here, but a duplicate on the *named* path is a
 * plain human mistake (typing the same distinguishing name twice) with no
 * fork to offer — so it maps to a friendly inline message like every other
 * P2002 in this file.
 *
 * The "no collision to distinguish from" guard error is deliberately NOT
 * caught here — it rethrows to the app's error boundary, since no legitimate
 * UI flow can trigger it (the naming form only ever appears after a real
 * collision was already surfaced).
 */
export async function addNamedServiceAction(
  _prevState: AddServiceFormState,
  formData: FormData
): Promise<AddServiceFormState> {
  try {
    const event = await addNamedService({
      serviceDate: formData.get('serviceDate'),
      startTime: formData.get('startTime'),
      name: formData.get('name'),
    })
    return { ok: true, eventId: event.id }
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
 * Marks a service's counting finished, so the dashboard stops offering it as a
 * service to START counting. Deliberately NOT a gate: a done service still
 * accepts and corrects counts exactly like any other non-archived one —
 * saveCount continues to check isArchived only. This is dashboard
 * organization, not access control, which is why it's requireUser(), not
 * requireAdmin() like archiveEvent: any volunteer who can create an
 * additional service (see addService) can say they've finished counting it.
 */
export async function markCountingDone(input: unknown) {
  await requireUser()
  const id = idSchema.parse(input)

  const existing = await prisma.event.findUnique({ where: { id } })
  if (!existing) throw new Error('No such service')
  // Same sentence every other archived-refusal in this app uses. Marking an
  // archived service done is meaningless — it's already out of every picker.
  if (existing.isArchived) throw new Error('That service is not accepting counts')

  await prisma.event.update({ where: { id }, data: { isCountingDone: true } })
  revalidatePath('/dashboard')
  revalidatePath(`/entry/${id}`)
  revalidatePath('/settings')
}

/** Symmetric with markCountingDone — a mistaken tap must be reversible from
 * the UI, same reasoning as unarchiveEvent. Identical shape, opposite value. */
export async function reopenCounting(input: unknown) {
  await requireUser()
  const id = idSchema.parse(input)

  const existing = await prisma.event.findUnique({ where: { id } })
  if (!existing) throw new Error('No such service')
  if (existing.isArchived) throw new Error('That service is not accepting counts')

  await prisma.event.update({ where: { id }, data: { isCountingDone: false } })
  revalidatePath('/dashboard')
  revalidatePath(`/entry/${id}`)
  revalidatePath('/settings')
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
