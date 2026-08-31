# Agent Guidelines for church-attendance-app

This document encodes the project's conventions, tech decisions, and gotchas. Agents should read this before writing code.

<!-- BEGIN:nextjs-agent-rules -->

## Next.js 16.3.0 + React 19.2.8 (Bleeding Edge)

This codebase uses Next.js 16.3.0 and React 19.2.8 — both with **breaking changes** from earlier versions. Your training data is stale here.

**Before writing any code, read:**
- `node_modules/next/dist/docs/` for Next.js 16.3.0 API changes
- React 19 upgrade guide for hook/API changes
- next-auth v5.0.0-beta.32 migration guide (we're on beta, not stable)

**Key breaking changes:**
- React 19 compiler optimizes memoization automatically — manual `useMemo`/`useCallback` is now often worse, not better
- Next.js 16 has new routing and data-fetching patterns
- next-auth v5-beta has breaking API changes from v4

Do NOT apply optimization rules from older documentation. Test locally.

<!-- END:nextjs-agent-rules -->

---

## Authorization: Every Mutation Checks Allowlist

All mutations (server actions, API routes) **must** call `requireUser()` or `requireAdmin()` before modifying data.

**Pattern:**
```typescript
// src/lib/authz.ts
export async function requireUser(): Promise<CurrentUser> {
  // 1. Get session from next-auth
  const session = await auth()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) throw new AuthzError('UNAUTHENTICATED')

  // 2. Check Allowlist table — this revokes access immediately
  const entry = await prisma.allowlist.findUnique({ where: { email } })
  if (!entry || !entry.isActive) throw new AuthzError('FORBIDDEN')

  return { email: entry.email, role: entry.role as Role }
}
```

**Why this matters:**
- Deactivating an Allowlist row revokes access **immediately** — no JWT expiry wait.
- Every mutation re-checks, so the Allowlist is the source of truth.
- Never trust the session alone; always query the database.

**Do:**
- Start every server action with `const user = await requireUser()`
- Reject mutations on archived events or inactive categories
- Derive `recordedBy` from the session, never from input
- Use `requireAdmin()` for admin-only operations

**Don't:**
- Skip authorization checks (even for "harmless" reads that might leak permission state)
- Trust that a valid ID means access is permitted
- Allow input to override server-derived fields like `recordedBy`, `createdAt`, or role checks

---

## Prisma Conventions

### Schema Guards
Three models have `isActive` or `isArchived` fields to soft-delete without losing data:
- `Event.isArchived` — closed service dates don't accept counts
- `Category.isActive` — retired sections don't accept counts
- `Allowlist.isActive` — revokes access without deleting the user record

Always check these in mutations: if an event is archived, reject the count.

### Data Model
```
Allowlist (who can sign in)
├─ email (unique)
├─ googleSub (for future OAuth)
├─ role (ADMIN | VOLUNTEER)
└─ isActive (revokes access immediately)

Event (a service date)
├─ serviceDate (YYYY-MM-DD, not a timestamp — see src/lib/dates.ts)
├─ name (event name within that date)
├─ isArchived (soft-delete)
└─ records (AttendanceRecord[])

Category (a section/classroom/metric to count)
├─ type (SECTION | CLASSROOM | GROWTH_TRACK | SERVE_TEAM | SERVICE_METRIC)
├─ name (unique per type)
├─ countsTowardTotal (false for metrics like Salvations that shouldn't be in Total)
├─ svgKey (for sanctuary map visualization)
├─ sortOrder (UI ordering)
├─ isActive (soft-delete)
└─ records (AttendanceRecord[])

AttendanceRecord (the actual count)
├─ eventId + categoryId (unique — upsert prevents double-counts)
├─ count (the number)
├─ recordedBy (derived from session — never from input)
└─ timestamps
```

### Idempotency Pattern
Use `upsert` for counts — double-taps or a second volunteer don't double-count:
```typescript
await prisma.attendanceRecord.upsert({
  where: { eventId_categoryId: { eventId, categoryId } },
  create: { eventId, categoryId, count, recordedBy: user.email },
  update: { count, recordedBy: user.email }, // overwrite, don't accumulate
})
```

### Validation Before Mutation
Always fetch and validate referenced rows before writing:
```typescript
const [event, category] = await Promise.all([
  prisma.event.findUnique({ where: { id: eventId } }),
  prisma.category.findUnique({ where: { id: categoryId } }),
])
if (!event || event.isArchived) throw new Error('That service is not accepting counts')
if (!category || !category.isActive) throw new Error('That category is no longer active')
```

This prevents writing orphaned records and enforces business rules.

---

## Server Actions & Cache Invalidation

All mutations are server actions in `/src/lib/actions/*.ts`:
- `attendance.ts` — save/get counts
- `events.ts` — create/edit/archive events
- `categories.ts` — create/edit/deactivate categories
- `allowlist.ts` — manage users

**Always call `revalidatePath()` after mutations:**
```typescript
await prisma.attendanceRecord.upsert(/* ... */)
revalidatePath(`/entry/${eventId}`)  // the entry form
revalidatePath(`/report/${eventId}`) // the report that shows totals
return { ok: true as const }
```

Stale data in the UI is worse than a brief loading state. When in doubt, revalidate.

---

## Validation with Zod

All server action inputs are validated with Zod schemas in `src/lib/validation.ts`:
```typescript
import { saveCountSchema } from '@/lib/validation'
const { eventId, categoryId, count } = saveCountSchema.parse(input)
```

**Do:**
- Parse input with Zod before using it
- Use `.trim().toLowerCase()` for emails
- Let parse errors throw (they become bad request responses)

**Don't:**
- Trust input types — parse to Zod schemas first
- Use `unsafe` parsing
- Skip validation for "trusted" internal calls

---

## next-auth v5.0.0-beta.32 Specifics

This app uses next-auth **beta**, not stable v5. Breaking changes are possible.

**Session structure:**
```typescript
session.user.email  // the primary identifier
session.user.name   // optional (not used here)
```

**Authorization flow:**
1. OAuth provider (Google) → next-auth session
2. Server action calls `auth()` to get session
3. If email exists in Allowlist and `isActive`, grant access
4. If not, throw `AuthzError('FORBIDDEN')`

**Do:**
- Always call `auth()` at the start of protected server actions
- Trim and lowercase emails for comparison
- Assume the session.user.email is the source of truth

**Don't:**
- Cache the session in memory (re-fetch on each mutation)
- Trust the session without checking the Allowlist

---

## Testing

- **Unit tests:** 17 specs in Vitest — fast, run first
- **E2E tests:** 1 spec in Playwright against next-auth — covers the auth surface

**The gap:** Counting logic (saveCount, getEventCounts) has only unit tests. E2E coverage is thin.

**When writing tests:**
- Unit: test Zod schemas, business logic, Prisma queries with mocks
- E2E: test auth flow and critical user paths (record a count, generate a report)
- Don't e2e everything — keep the suite fast; only test high-risk flows

---

## Common Gotchas

### Date Handling
`Event.serviceDate` is a string `YYYY-MM-DD`, not a timestamp. See `src/lib/dates.ts` for church-local calendar logic. Don't use `new Date()` directly; use the helpers.

### SVG Sanctuary Map
`Category.svgKey` keys into an SVG map element. Unknown keys are silently ignored. Keep the keys in sync with the SVG.

### Permissions Don't Cache
Every mutation re-fetches the Allowlist. If an admin deactivates a user, that user can't act on the next request — no waiting for a JWT to expire. This is intentional.

### Next.js 16 Cache Hierarchy
Next.js 16 has complex caching rules. If a mutation works locally but not in prod, suspect cache expiry. Use `revalidatePath()` liberally.

---

## File Structure

```
src/
├─ app/
│  ├─ api/          API routes (health checks, etc.)
│  ├─ dashboard/    Volunteer dashboard
│  ├─ denied/       Auth failure page
│  ├─ entry/        Attendance entry form
│  ├─ login/        Sign-in page
│  ├─ report/       Attendance report
│  └─ settings/     Admin settings
├─ lib/
│  ├─ actions/      Server actions (mutations)
│  ├─ authz.ts      Authorization helpers
│  ├─ dates.ts      Date utilities (church-local calendar)
│  ├─ prisma.ts     Prisma client singleton
│  └─ validation.ts Zod schemas
└─ components/      React components
```

---

## Before Submitting

- [ ] Read the schema comments — they encode business rules
- [ ] Call `requireUser()` or `requireAdmin()` at the start of mutations
- [ ] Check `isArchived` and `isActive` before mutations
- [ ] Validate input with Zod — don't trust what comes in
- [ ] Call `revalidatePath()` after mutations
- [ ] Run `npm run lint && npm run test` — both must pass
- [ ] If you touch auth or counts, write an e2e test
