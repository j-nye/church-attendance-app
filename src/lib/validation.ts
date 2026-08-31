import { z } from 'zod'

export const CATEGORY_NAME_MAX = 60
export const EVENT_NAME_MAX = 80
export const MAX_COUNT = 100_000

/** cuid-shaped identifier. Existence is checked against the DB in the action. */
export const idSchema = z.string().trim().min(1).max(40)

export const categoryTypeSchema = z.enum([
  'SECTION',
  'CLASSROOM',
  'GROWTH_TRACK',
  'SERVE_TEAM',
  'SERVICE_METRIC',
])
export const roleSchema = z.enum(['ADMIN', 'VOLUNTEER'])

export const serviceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Service date must be YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
  }, 'Service date is not a real calendar date')

export const saveCountSchema = z.object({
  eventId: idSchema,
  categoryId: idSchema,
  count: z.number().int().min(0).max(MAX_COUNT),
})

export const deleteCountSchema = z.object({
  eventId: idSchema,
  categoryId: idSchema,
})

export const SPEAKER_NAME_MAX = 80

export const speakerNameSchema = z.string().trim().min(1).max(SPEAKER_NAME_MAX)

export const addSpeakerSchema = z.object({
  eventId: idSchema,
  name: speakerNameSchema,
})

export const removeSpeakerSchema = z.object({
  eventId: idSchema,
  speakerId: idSchema,
})

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  type: categoryTypeSchema,
  svgKey: z.string().trim().max(40).nullable().default(null),
  countsTowardTotal: z.boolean().default(true),
})

export const updateCategorySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  sortOrder: z.number().int().min(0).max(999),
})

export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(EVENT_NAME_MAX),
  serviceDate: serviceDateSchema,
})

export const allowlistEntrySchema = z.object({
  // Zod 4 deprecated method-style `z.string().email()` in favor of top-level `z.email()`.
  // Transform and length-check as a string first, then pipe into the email validator.
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: roleSchema,
})

export type SaveCountInput = z.infer<typeof saveCountSchema>
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type CreateEventInput = z.infer<typeof createEventSchema>
export type AllowlistEntryInput = z.infer<typeof allowlistEntrySchema>

/**
 * Turns the first Zod issue into one short, user-facing sentence instead of
 * Zod 4's raw internal wording (e.g. "Too small: expected string to have
 * >=1 characters"). Scoped deliberately narrow — only the fields the two
 * /settings "add" forms (add category, authorize an email) actually submit
 * have a specific label; anything else falls back to a generic phrase
 * rather than leaking Zod's internal terms. This is not a general-purpose
 * Zod formatter.
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Category type',
  email: 'Email address',
  role: 'Role',
}

export function friendlyValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  const field = String(issue.path[0] ?? '')
  const label = FIELD_LABELS[field] ?? 'That field'

  switch (issue.code) {
    // A field that's missing entirely (invalid_type: expected string,
    // received undefined) and a field that's present but empty
    // (too_small on a .min(1) string) both read the same to a volunteer.
    case 'invalid_type':
    case 'too_small':
      return `${label} is required.`
    case 'too_big':
      return `${label} is too long.`
    case 'invalid_format':
      return `${label} doesn't look like a valid email address.`
    case 'invalid_value':
      return `${label} must be one of the listed options.`
    default:
      return `${label} is not valid.`
  }
}
