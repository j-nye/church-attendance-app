# Service Times, Recorder Names, and Allowlist Grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for implementation.

**Goal:** Address three pieces of owner feedback, in priority order:

1. **Multiple services on one date, at different times.** Add a required start time to `Event`, make it editable after creation, order and display services by it, and — most importantly — stop the dashboard's "Start counting today's service" button from silently guessing which of the day's services a volunteer means.
2. **Show who entered each count, by name.** Capture a display name per person, resolve `recordedBy` emails to names at read time, and surface attribution on the report page (visible to everyone signed in), the Manage table, and the CSV export.
3. **Group the allowlist by access level.** Replace the flat list on `/settings` with Admins / Volunteers / Revoked groups so an admin isn't scrolling one long run of addresses.

**Architecture:** Three mostly-independent phases sharing no code. Phase 1 adds `Event.startTime` (a `"HH:mm"` string, matching the existing deliberate choice to store `serviceDate` as a `YYYY-MM-DD` string rather than a timestamp — see `src/lib/dates.ts`), a new `updateEventSchedule` Server Action (date *and* time together), and a today-service **picker** replacing `getOrCreateTodayEvent`'s implicit `findFirst`. Phase 2 adds `Allowlist.name`, populated from the Google profile in the existing `signInCallback` and overridable by an admin, plus a small `resolveDisplayNames()` helper that batch-maps emails to names for the read paths that need it — `recordedBy` itself keeps storing the email, which stays the stable identifier. Phase 3 is a presentational regroup of one section of `src/app/settings/page.tsx` into a new `AllowlistSection` component.

**Tech Stack:** Next.js 16.3.4 App Router (Server Components + Server Actions), React 19.2.8, Prisma 6.19.3 (two real migrations against the Neon dev DB), next-auth v5.0.0-beta.32, Zod 4, Vitest, Playwright.

**Owner decisions captured 2026-09-07:**
- Recorder attribution on the report is visible to **everyone signed in**, not admins only. This deliberately reverses the existing volunteer-masking rule in `getEventSummary` — see Global Constraints.
- `startTime` is **required** for new services. Existing rows are backfilled to `09:30`.
- Service time is **editable after creation** (someone will pick the wrong one).
- Display name comes from the **Google profile, with an admin override**.

## Global Constraints

- Every new mutation (`updateEventSchedule`, `updateAllowlistName`) calls `requireAdmin()` first — both are settings-level operations, not volunteer-recordable ones.
- Every new input is Zod-parsed in `src/lib/validation.ts` before use; every mutation calls `revalidatePath()` for each affected route.
- `startTime` is a `"HH:mm"` 24-hour string in church-local time. It is **never** a `DateTime` and never goes through `new Date()`. Rendering to "9:30 AM" is a pure string transform in `src/lib/dates.ts`, alongside `formatServiceDate` — do not introduce a timezone conversion into this path. `CHURCH_TIMEZONE` is documented as confirmed-correct and must not be touched.
- **The `@@unique([serviceDate, name])` constraint stays exactly as it is.** Do not add `@@unique([serviceDate, startTime])`: two genuinely simultaneous services (e.g. a 9:30 sanctuary service and a 9:30 Spanish-language service) is a real scenario, and the name constraint already prevents true duplicates. `getOrCreateTodayEvent`'s P2002 race recovery also depends on the name being the deterministic key.
- Because `serviceDate` is half that unique constraint, **editing a date can collide** with an existing service of the same name on the target date. `updateEventSchedule` must catch P2002 and return the same friendly sentence `createEventAction` already uses, not surface a raw Prisma error.
- **An archived service's schedule is not editable.** The archive confirmation dialog already promises the user "An archived service stops accepting counts and edits" — honor that literally. To fix an archived service, unarchive it (already supported and symmetric), edit, re-archive.
- `AttendanceRecord.recordedBy` and `ServiceSpeaker.recordedBy` continue to store the **email**, not a name. Email is the stable identifier, it is what existing rows and `AuditLog.actorEmail` contain, and a person's display name can change. Names are resolved at read time only. Do not migrate historical `recordedBy` values.
- The existing security test `tests/actions-attendance.test.ts:160` ("always derives recordedBy from the session, ignoring any recordedBy-shaped value the caller supplies") must keep passing unchanged. Nothing in this plan may let a display name — or a `recordedBy` — arrive from client input.
- `Allowlist.name` is **optional** (`String?`). Someone allowlisted who has never signed in has no name; every display path falls back to the email address. There is no state in which a row is unrenderable.
- The CSV export's existing `Recorded By` column keeps carrying the **email**, unchanged. Name is an *additional* column. Removing or repurposing an existing column would silently break whatever spreadsheets the owner already has.
- No synchronous helper may be exported from a `'use server'` file — `resolveDisplayNames()` goes in a plain module (`src/lib/display-names.ts`), never in `src/lib/actions/*.ts`. This exact mistake has bitten this project before and is caught by *nothing* in CI: not lint, not tsc, not `npm run build`, only Turbopack's dev import graph. See the roadmap's 2026-08-31 session log.
- `npm run lint && npm test && npx tsc --noEmit` must pass at the end of every task.

## Non-goals

- No per-service recurring templates or "copy last week's services" feature.
- No editing a service's **name** after creation. Name is half the `@@unique([serviceDate, name])` constraint and is how `getOrCreateTodayEvent`'s race recovery re-finds its winner; date and time are enough to correct a mis-created service. Flag it to the owner rather than building it.
- **No new work is needed to edit counts on a past service** — that already works today and must not regress. `saveCount` gates on `event.isArchived` only, never on the date, so any non-archived past service accepts and corrects counts through the normal entry screen; `createEvent` likewise accepts any real calendar date, so a service can be created retroactively. The only genuine gap the owner hit is *correcting a wrong date*, which Task 1.3 covers.
- No user profile page, avatars, or Google profile photos.
- No name for `AuditLog.actorEmail` display — the audit trail is deliberately raw and identifier-based.
- No search/filter box on the allowlist. Grouping was the ask; if the list is still unwieldy afterward, that is a separate follow-up.

---

## Phase 1 — Multiple services per date, at different times

### Task 1.1: `Event.startTime` schema and backfill migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_event_start_time/migration.sql`

**Interfaces:** Produces `Event.startTime: string` on the generated client, consumed by every subsequent Phase 1 task.

- [ ] **Step 1: Add the field to the `Event` model**

```prisma
model Event {
  id          String             @id @default(cuid())
  name        String
  /// Church-local calendar date as YYYY-MM-DD. NOT a timestamp — see src/lib/dates.ts.
  serviceDate String
  /// Church-local start time as 24-hour "HH:mm". NOT a timestamp and NOT
  /// timezone-converted — same reasoning as serviceDate. Multiple services can
  /// share a serviceDate; this is what distinguishes and orders them.
  /// Existing rows were backfilled to '09:30' when this column was added.
  startTime   String
  isArchived  Boolean            @default(false)
  ...
  @@index([serviceDate, startTime])
}
```

Keep the existing `@@unique([serviceDate, name])` and `@@index([serviceDate])`.

- [ ] **Step 2: Generate the migration, then hand-edit it for the backfill**

`prisma migrate dev --name add_event_start_time --create-only` will emit an `ADD COLUMN ... NOT NULL` with no default, which fails against a table with existing rows. Edit the generated SQL to add the column with the backfill default and then drop the default, so the application is forced to supply a value going forward rather than silently inheriting 09:30:

```sql
ALTER TABLE "Event" ADD COLUMN "startTime" TEXT NOT NULL DEFAULT '09:30';
CREATE INDEX "Event_serviceDate_startTime_idx" ON "Event"("serviceDate", "startTime");
```

**Do NOT add `ALTER COLUMN "startTime" DROP DEFAULT` to this migration.** Vercel's Build Command is `npx prisma migrate deploy && next build` (see `docs/superpowers/plans/2026-08-31-deploy-checklist.md`), so the migration runs *during the build*, while the **previous** deployment is still serving traffic. Between the migration completing and the new build cutting over, the old code is live against the new column — and the old `getOrCreateTodayEvent`/`createEvent` insert an `Event` with no `startTime`. Without a database default that insert is a NOT NULL violation: a volunteer tapping "Start counting today's service" during the build window gets an error page. The default is what keeps the old code working for those few minutes.

The requirement is still enforced in application code: `startTime` is declared **without** `@default` in `schema.prisma`, so Prisma's generated create types make it mandatory. Database default for the rollout window, type-level requirement for the code — the guarantees do not overlap and both are wanted.

- [ ] **Step 2a: Plan the follow-up contract migration**

Because the schema declares no `@default` while the database has one, the next `prisma migrate dev` will notice and try to fold a `DROP DEFAULT` into whatever unrelated migration you are generating at the time. Don't let it land by accident: once this release is deployed and confirmed live, add a deliberate one-line migration that drops the default, and note it in the deploy checklist. Standard expand/contract — expand now, contract after the rollout.

- [ ] **Step 3: Apply it and confirm**

Run `prisma migrate dev` against the Neon dev database. Verify with a query that every pre-existing `Event` row now reads `09:30` and that `npx tsc --noEmit` sees `startTime` on the client type.

### Task 1.2: Time validation and formatting helpers

**Files:**
- Modify: `src/lib/validation.ts`, `src/lib/dates.ts`
- Modify: `tests/validation.test.ts`, `tests/dates.test.ts`

**Interfaces:** Produces `startTimeSchema`, an extended `createEventSchema`, a new `updateEventScheduleSchema`, and `formatServiceTime()`. Consumed by Tasks 1.3–1.6.

- [ ] **Step 1 (RED): Write the failing tests first**

In `tests/validation.test.ts`, assert `startTimeSchema` accepts `'09:30'`, `'00:00'`, `'23:59'`; rejects `'9:30'` (unpadded), `'24:00'`, `'12:60'`, `'9:30 AM'`, `''`, and a non-string. Assert `createEventSchema` now requires `startTime` and that a missing one produces the `friendlyValidationMessage` sentence `Service time is required.`

In `tests/dates.test.ts`, assert `formatServiceTime('09:30') === '9:30 AM'`, `'13:05' → '1:05 PM'`, `'00:00' → '12:00 AM'`, `'12:00' → '12:00 PM'`. Include an explicit regression case asserting the result is identical regardless of the ambient `TZ` — this function must contain no timezone logic at all.

- [ ] **Step 2 (GREEN): Implement**

In `src/lib/validation.ts`:

```ts
/** Church-local 24-hour "HH:mm". Not a timestamp — see src/lib/dates.ts. */
export const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Service time must be a 24-hour HH:mm time')

export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(EVENT_NAME_MAX),
  serviceDate: serviceDateSchema,
  startTime: startTimeSchema,
})

export const updateEventScheduleSchema = z.object({
  id: idSchema,
  serviceDate: serviceDateSchema,
  startTime: startTimeSchema,
})
```

Add `startTime: 'Service time'` to `FIELD_LABELS`. Note that a bad-format time hits Zod's `invalid_format` code, whose `default`/non-email branch already yields `Service time is not valid.` — confirm the test asserts the sentence the implementation actually produces.

In `src/lib/dates.ts`, add `formatServiceTime()` as pure string arithmetic — split on `:`, convert hour to 12-hour with an AM/PM suffix. Document in a comment that it deliberately does not construct a `Date`, for the same reason `formatServiceDate` anchors itself to UTC.

### Task 1.3: `createEvent` and the new `updateEventSchedule` action

**Files:**
- Modify: `src/lib/actions/events.ts`
- Modify: `tests/actions-events.test.ts`

- [ ] **Step 1 (RED): Tests**

- `createEvent` persists `startTime` and rejects input with no `startTime` (ZodError).
- `createEventAction` returns `{ ok: false, message: 'Service time is required.' }` when the form omits it.
- `updateEventSchedule` calls `requireAdmin()` first — assert it throws `AuthzError('FORBIDDEN')` for a VOLUNTEER and never reaches Prisma.
- `updateEventSchedule` Zod-rejects a malformed time **and** a malformed date, reusing the existing `serviceDateSchema` (which already rejects non-calendar dates like `2026-02-30`).
- It updates date and time **together** in one write — assert a single `prisma.event.update` carrying both fields, so a service can never land half-moved.
- It moves a service to a **past** date without complaint. There is deliberately no "not in the past" rule: correcting last Sunday's mis-dated service is the owner's stated reason this action exists.
- A date change that collides with an existing `(serviceDate, name)` returns the friendly `'A service with that name already exists on that date.'` — the same sentence `createEventAction` uses — not a raw P2002.
- It **refuses an archived service** with `'That service is not accepting counts'`, matching the promise the archive dialog already makes to the user.
- A nonexistent id surfaces a clean error, not a raw P2025.
- It revalidates `/dashboard`, `/settings`, `/entry/<id>`, `/report/<id>`, **and `/report/<id>/manage`** — that page renders the service date in its own header, and `deleteCount` already revalidates it for the same reason.

- [ ] **Step 2 (GREEN): Implement**

Add `startTime` to `createEvent`'s destructure and `prisma.event.create`. Add `startTime: formData.get('startTime')` to `createEventAction`.

Add:

```ts
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
```

Wrap this in a `useActionState`-compatible `updateEventScheduleAction` alongside the existing `createEventAction`, with the identical error ladder — `AuthzError` → `'You are not authorized to do that.'`, `ZodError` → `friendlyValidationMessage`, `P2002` → `'A service with that name already exists on that date.'`, anything else rethrown. Moving a date is exactly as collision-prone as creating one, so the P2002 branch is not optional here.

- [ ] **Step 3: Update every event-ordering query**

`listEvents`, `listRecentEvents`, and `listEventsInRange` all currently order by `[{ serviceDate }, { name: 'asc' }]`. Change the secondary key to `startTime` with `name` as the tiebreaker: `[{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }]` (and `serviceDate: 'asc'` for `listEventsInRange`). This is the fix for "11:00 AM sorts before 9:00 AM". Do the same for `getExportRows`' `orderBy` in `src/lib/actions/attendance.ts`.

### Task 1.4: Fix the today-service guess — the correctness fix

**Files:**
- Modify: `src/lib/actions/events.ts`, `src/app/dashboard/page.tsx`
- Modify: `tests/actions-events.test.ts`

This is the highest-value task in the plan. Today, `getOrCreateTodayEvent()` does `findFirst({ where: { serviceDate, isArchived: false }, orderBy: { name: 'asc' } })`. With two services on a date it returns an arbitrary one, so a volunteer at the 11:00 service can be dropped into the 9:00 service's entry screen and overwrite its counts. The upsert idempotency that normally protects against double-counting makes this *worse*, not better — the wrong service's numbers are silently replaced.

- [ ] **Step 1 (RED): Tests**

- `listTodayEvents()` returns all of today's non-archived services ordered by `startTime`.
- `getOrCreateTodayEvent()` still creates-and-returns when today has **zero** services (the "no admin set it up" path this function exists for must not regress), stamping the new row with a documented default `startTime` of `'09:30'` and a name that includes the time.
- `getOrCreateTodayEvent()` **throws** (or returns a discriminated `{ ambiguous: true, events }`) when today has more than one service — it must never guess. Pick one shape and assert it.
- The existing P2002 race-recovery test still passes.

- [ ] **Step 2 (GREEN): Implement**

Add `listTodayEvents()` (`requireUser`, `todayServiceDate()`, ordered by `startTime asc`). Rework `getOrCreateTodayEvent` so the >1 case is explicit rather than implicit. Keep the existing P2002 re-fetch, but make its re-fetch order by `startTime` so the winner is deterministic under the new ordering.

- [ ] **Step 3: Dashboard UI**

Replace the single "Start counting today's service" submit button in `src/app/dashboard/page.tsx` with behavior driven by `listTodayEvents()`:
- **0 services today** → keep today's button exactly as it is (creates and redirects).
- **exactly 1** → keep the button, label it with that service's time: "Start counting — 9:30 AM".
- **2 or more** → render one button per service instead, each labeled with its time, each posting that specific `eventId`. No default selection, no auto-redirect.

Pass `formatServiceTime(event.startTime)` into `ServiceCard` and render it next to the date so the list itself distinguishes same-date services.

### Task 1.5: Surface the time everywhere a service is displayed

**Files:**
- Modify: `src/components/ServiceCard.tsx`, `src/components/ServicesSection.tsx`, `src/app/entry/[eventId]/page.tsx`, `src/app/report/[eventId]/page.tsx`, `src/app/report/[eventId]/manage/page.tsx`

- [ ] **Step 1: Create form** — add a required `<input name="startTime" type="date"→"time" required defaultValue="09:30">` to `CreateServiceForm` in `ServicesSection.tsx`. An `<input type="time">` submits exactly `"HH:mm"`, which is the storage format — no parsing needed.
- [ ] **Step 2: Edit date and time** — add an "Edit" control to `ServiceRow` revealing a small inline form with a `type="date"` and a `type="time"` input, both pre-filled from the row, submitting to `updateEventScheduleAction`. Follow the existing `unarchive` pattern in that same component for busy/error state (`setBusy`/`setError`, a `role="alert"` paragraph) rather than inventing a new one, and surface the P2002 collision message inline where the user can act on it.

  Hide or disable the Edit control on an **archived** row — the server already refuses, and offering a control that always fails is worse than not offering it. The row already renders at `opacity: 0.6` with an "archived" label, so the affordance difference reads correctly.
- [ ] **Step 3: Headings** — every page that renders `formatServiceDate(event.serviceDate)` as a subheading (entry, report, manage) now renders date **and** time. With multiple same-date services, a report printed without a time on it is ambiguous on paper, which is where these reports actually live.

Per this project's established convention, UI-wiring steps get no new automated tests — verification is a type-check, a green suite, and the manual checklist below.

### Task 1.6: CSV export gains a time column

**Files:** Modify `src/lib/actions/attendance.ts`, `src/app/api/export/route.ts`, `tests/api-export.test.ts`

- [ ] **Step 1 (RED):** Assert the CSV header is `Service Date, Service Time, Service Name, ...` and that a row carries the formatted time. Assert speaker rows (`categoryType: 'SPEAKER'`) carry it too.
- [ ] **Step 2 (GREEN):** Add `serviceTime` to `ExportRow`, populate it in both the attendance-row and speaker-row branches of `getExportRows`, and insert `'Service Time'` into `COLUMNS` and `toCsvRow` immediately after `'Service Date'`. Two same-date services are otherwise indistinguishable in the export except by name.

---

## Phase 2 — Recorder display names

### Task 2.1: `Allowlist.name` schema and migration

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/<timestamp>_add_allowlist_name/migration.sql`

- [ ] **Step 1:** Add to the `Allowlist` model:

```prisma
  /// The name Google reports for this person. Re-synced on EVERY sign-in, so a
  /// legitimate name change (marriage, correction) propagates on next login.
  /// Null until their first sign-in.
  name              String?
  /// An admin's manual correction, which always wins over `name`. Kept in its
  /// own column precisely so the two sources stay distinguishable: with a
  /// single column there is no way to tell "an admin corrected this" from
  /// "Google changed this", which forces a choice between clobbering the
  /// correction every Sunday and freezing the Google name forever.
  /// Display resolves as `adminOverrideName ?? name`.
  adminOverrideName String?
```

- [ ] **Step 2:** `prisma migrate dev --name add_allowlist_name`. Both nullable, so no backfill is needed. Existing rows show as emails until their owner next signs in.

### Task 2.2: Capture the name at sign-in

**Files:** Modify `src/lib/auth.ts`, `src/types/next-auth.d.ts`; modify `tests/auth.test.ts`

- [ ] **Step 1 (RED): Tests against `signInCallback` directly** (the module is deliberately structured for this):
  - A successful sign-in with `profile.name` writes that name onto the allowlist row.
  - A sign-in whose stored name already matches writes nothing (no pointless update).
  - A profile with **no** name leaves an existing stored name untouched — Google not returning a name must never blank out a good value.
  - A sign-in with a **changed** Google name updates `name` (no one-way latch — a legitimate name change must propagate).
  - **`adminOverrideName` is never written by the sign-in path at all.** Assert it is untouched across a sign-in whose Google name differs — this is the guarantee the two-column design exists to provide.
  - The allowlist gate itself is unchanged: a non-allowlisted or inactive email still returns `false`, and no name is written for a rejected sign-in.

- [ ] **Step 2 (GREEN): Implement, and decide the override rule explicitly**

Extend the existing `googleSub` binding block in `signInCallback` to also persist `profile.name` — **unconditionally, on every sign-in**:

```ts
if (profile.name && entry.name !== profile.name) {
  // Always re-sync: `name` is a mirror of what Google reports, nothing more.
  // An admin's correction lives in adminOverrideName and is never touched here,
  // so re-syncing cannot clobber it.
  data.name = profile.name
}
```

Combine this with the existing `googleSub` update into a single `update` call rather than issuing two writes, and skip the write entirely when nothing changed.

Because the override lives in its own column, there is no latch and no lost update: Google's name stays current, the admin's correction stays authoritative, and clearing `adminOverrideName` simply falls back to whatever Google most recently reported.

Also add `name` to `sessionCallback`/`jwtCallback` only if a later task actually needs it in the session. It probably does not — every display path reads from the database — so prefer not to widen the token.

### Task 2.3: `resolveDisplayNames()` — a plain, non-action module

**Files:** Create `src/lib/display-names.ts`; create `tests/display-names.test.ts`

- [ ] **Step 1 (RED): Tests**
  - Maps a set of emails to names in **one** `findMany` query, not N queries. Assert the call count.
  - An email with no allowlist row resolves to **`null`**, never to the email string.
  - An email whose row has no name resolves to **`null`**, never to the email string.
  - Resolution prefers `adminOverrideName` over `name` when both are set.
  - An empty input set makes **zero** queries and returns an empty map.
  - Lookup is case-insensitive on the stored email — `recordedBy` was written lowercased by `requireUser`, but assert it rather than assuming.

- [ ] **Step 2 (GREEN): Implement**

```ts
/**
 * Batch-resolve recordedBy emails to display names.
 *
 * Deliberately a plain module, NOT an export of a 'use server' file: Next.js 16
 * requires every export of such a file to be an async Server Action, and a
 * synchronous-shaped helper exported from one breaks the build in a way that
 * neither lint, tsc, the test suite, nor `next build` catches — only Turbopack's
 * dev import graph does. Same reason src/lib/prisma-errors.ts exists.
 */
export async function resolveDisplayNames(
  emails: Iterable<string>
): Promise<Map<string, string | null>>
```

**Returns `null` for an unknown email — it never echoes the email back.** That asymmetry is load-bearing: an email-shaped fallback here would travel straight through `getEventSummary`'s unconditional `recordedByName` field and put a raw address in front of every volunteer, silently defeating the admin-only rule on emails. Callers decide what an unknown name looks like for *their* audience; this function never decides it for them. Prefer `adminOverrideName` over `name` when both are set.

### Task 2.4: Report page shows attribution — to everyone

**Files:** Modify `src/lib/actions/attendance.ts`, `src/app/report/[eventId]/page.tsx`, `tests/actions-attendance.test.ts`

This reverses a deliberate existing rule, and the change must be made loudly rather than by quietly deleting a conditional.

- [ ] **Step 1 (RED): Tests**
  - `getEventSummary` now returns `recordedByName` on every row for a **VOLUNTEER** as well as an ADMIN. The two existing tests at `tests/actions-attendance.test.ts:285` ("hides recordedBy from a volunteer") and `:292` are the ones being changed — **rewrite them to encode the new rule**, don't delete them.
  - `recordedBy` (the raw email) stays **ADMIN-only**. The reversal is about showing *names* to volunteers; it is not a decision to start leaking colleagues' email addresses into a volunteer-facing view, and nothing in the feedback asks for that.
  - **A row whose recorder has no resolvable name never shows a volunteer the email.** Assert it directly: as a VOLUNTEER, `recordedByName` for an unknown recorder is `'Unknown'` and does **not** contain an `@`. As an ADMIN it may fall back to the email. Write this even though it looks redundant against the masking tests — it is the regression test for the leak below.
  - `getEventSummary` issues one name-resolution query regardless of row count.

- [ ] **Step 2 (GREEN): Implement**

In `getEventSummary`, collect the distinct `recordedBy` values, call `resolveDisplayNames()` once, and add `recordedByName: string` to each row unconditionally.

**Resolve the null case per-audience, or this feature leaks the very emails it is meant to keep admin-only:**

```ts
const resolved = names.get(record.recordedBy) ?? null
const recordedByName =
  resolved ?? (user.role === 'ADMIN' ? record.recordedBy : 'Unknown')
```

Without that branch, an email-shaped fallback reaches every volunteer through the field added to satisfy the *names* request. Not hypothetical: a volunteer since removed from the allowlist has no row to resolve, and their historical counts are exactly what someone reviewing an old service is looking at.

Leave the existing `recordedBy: user.role === 'ADMIN' ? ... : undefined` line **exactly as it is** and update the surrounding doc comment to state the new split precisely: names for everyone, raw emails for admins only.

Also return a service-level `recordedByNames: string[]` — the distinct recorders for the whole event, in first-recorded order. The feedback asks who entered information "into each service", which is a per-service question, not only a per-row one.

- [ ] **Step 3: Render it**

On the report page, add a "Counts entered by: …" line in the header block next to the existing "Speakers:" line, fed by `recordedByNames`, with an em dash when empty. Add a right-aligned "Recorded by" column to each category table. Confirm against `src/styles/print.css` that the extra column doesn't break the printed layout — these reports are printed, and that stylesheet is the arbiter.

### Task 2.5: Manage table and CSV export

**Files:** Modify `src/lib/actions/attendance.ts`, `src/components/ManageTable.tsx`, `src/app/api/export/route.ts`, `tests/actions-attendance.test.ts`, `tests/api-export.test.ts`

- [ ] **Step 1 (RED):** `getManageRows` returns `recordedByName` alongside `recordedBy`. `getExportRows` returns it too. The CSV header gains `Recorded By Name` immediately after the existing `Recorded By`; assert the existing `Recorded By` column still carries the **email**, unchanged and in its original position.
- [ ] **Step 2 (GREEN):** Add the field to `ManageRow` and `ExportRow`, resolve names once per call, and render `{row.recordedByName ?? '—'}` at `ManageTable.tsx:61`. Both paths are admin-only end to end (`getManageRows` and `getExportRows` each call `requireAdmin()`), so the email fallback is correct here — unlike `getEventSummary`, which is not. This is an admin view, so show the email as a `<small>` beneath the name — an admin revoking access needs the address, and the name alone is ambiguous if two people share one.
- [ ] **Step 3:** Speaker rows in `getExportRows` get the same treatment — `ServiceSpeaker.recordedBy` is an email on the identical footing.

### Task 2.6: Admin name override in Settings

**Files:** Modify `src/lib/actions/allowlist.ts`, `src/lib/validation.ts`; modify `tests/actions-allowlist.test.ts`

- [ ] **Step 1 (RED):** `updateAllowlistName` requires ADMIN; Zod-trims and length-caps the name (reuse `SPEAKER_NAME_MAX`'s 80, or add `DISPLAY_NAME_MAX = 80` for clarity); an empty string clears `adminOverrideName` back to `null`, after which display falls through to Google's `name`; a nonexistent id errors cleanly; `revalidatePath('/settings')` is called.
- [ ] **Step 2 (GREEN):** Implement `updateAllowlistName` — writing **`adminOverrideName`, never `name`** — plus a `useActionState`-compatible `updateAllowlistNameAction`, following the exact shape of the existing `addAllowlistEntryAction` (AuthzError → inline message, ZodError → `friendlyValidationMessage`, anything else rethrown). Add `name: 'Name'` to `FIELD_LABELS`.
- [ ] **Step 3:** Extend `listAllowlist` to order by `[{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }, { email: 'asc' }]` so Phase 3's grouping gets pre-sorted data. Note `role: 'asc'` puts `ADMIN` before `VOLUNTEER` alphabetically — convenient, but Phase 3 must not depend on that accident; it groups explicitly.

---

## Phase 3 — Group the allowlist by access level

### Task 3.1: `AllowlistSection` component

**Files:** Create `src/components/AllowlistSection.tsx`; modify `src/app/settings/page.tsx`

- [ ] **Step 1:** Extract the existing "Who can sign in" `<section>` (currently inline at `src/app/settings/page.tsx:81`) into a client component taking `entries: AllowlistRowData[]`. Keep the `AddAllowlistForm` and the "Revoking takes effect immediately" note exactly where they are.

- [ ] **Step 2:** Render three groups, each a `<details>` with a `<summary>` carrying the group name and a live count:
  - **Admins** — active, `role === 'ADMIN'`. Open by default.
  - **Volunteers** — active, `role === 'VOLUNTEER'`. Open by default.
  - **Revoked** — `isActive === false`, both roles, role shown per row. **Collapsed** by default: this group only grows, and it is the main reason the list got long.

  Each row shows the display name with the email as muted secondary text (falling back to email-only when there's no name), the Revoke button for active entries, and the inline name-edit control from Task 2.6.

- [ ] **Step 3:** Preserve the two existing safety behaviors verbatim — an admin cannot revoke themselves, and the last active admin cannot be revoked. Both are enforced server-side in `deactivateAllowlistEntry` and must **stay** enforced there; the UI may additionally disable those buttons, but the server check is the boundary and is not to be relaxed because the UI now hides the button.

- [ ] **Step 4:** `<details>`/`<summary>` is deliberate — native disclosure gives keyboard and screen-reader behavior for free, and matches this codebase's preference for plain semantic elements over custom widgets.

---

## Regression inventory — existing tests this plan breaks

These are **not** optional cleanups. Each one is an existing assertion that will fail, traced against the current suite. Update them as part of the task that breaks them, never in a separate "fix the tests" pass — and never by loosening an assertion that was deliberately strict.

**The rule for this inventory:** if an existing test breaks because a *contract* changed, rewrite it to encode the new contract. If it breaks only because a *fixture* is now missing a required field, add the field and leave the assertion alone.

### `tests/prisma-schema.test.ts` — the one that mocks cannot catch

- **`:25`** — `prisma.event.create({ data: { name, serviceDate } })` against the **real database**. Once Task 1.1 drops the column default, this insert violates NOT NULL and the whole file's `beforeAll` fails, taking all of its `it`s with it. Every unit test in the suite mocks Prisma and will stay green while this one goes red in CI. Add `startTime: '09:30'` to the fixture. **Check this first after Task 1.1** — it is the highest-signal failure in the plan and the easiest to miss locally if you only run mocked tests.

### `tests/actions-events.test.ts`

- **`:77` `listEvents`** and **`:265` `listRecentEvents`** — both assert the exact `orderBy` array. Task 1.3 Step 3 changes it. Update to `[{ serviceDate: 'desc' }, { startTime: 'asc' }, { name: 'asc' }]`.
- **`:212` `listEventsInRange`** — same, with `serviceDate: 'asc'`. Its test name ("ordered by date then name") is now wrong and must be renamed too; a stale test name is how the next reader learns the wrong invariant.
- **`:101` `createEvent`** — asserts the exact create payload `{ data: { name, serviceDate } }`. Add `startTime`.
- **`:145` `getOrCreateTodayEvent` "returns the existing event for today"** — mocks `eventFindFirst`. If Task 1.4 reimplements the lookup with `findMany` (needed to detect the >1 case), this mock stops being reached and the test silently passes for the wrong reason or fails outright. Rewrite it against whichever delegate the new implementation actually calls, and add the >1 case as a new test rather than bending this one.
- **`:163` P2002 race recovery** — verified: it mocks `eventFindFirst`/`eventCreate` loosely and asserts a call count, so the `orderBy` change alone does not break it. It **will** break if Task 1.4 switches the re-fetch to `findMany`. Do not assume it survives; re-run it.
- **`:280` `createEventAction` happy path** and **`:302`/`:332`** (duplicate-P2002 and rethrow) — their `FormData` must gain a valid `startTime`, otherwise validation now fails first and they never reach the code path they exist to test. A test that passes for the wrong reason is worse than one that fails.
- **`:293` blank-name friendly message** — a live trap. With `startTime` newly required and absent from that `FormData`, the schema produces **two** issues, and `friendlyValidationMessage` reads `issues[0]`. Zod reports in schema key order and `name` is declared before `startTime`, so it happens to still yield `'Name is required.'` — by accident of field ordering, not by design. Add a valid `startTime` to the fixture so the test isolates the blank name it claims to test.
- **`:320` "no longer an admin"** — `requireAdmin` rejects before validation, so this one genuinely passes untouched. Left here so nobody "fixes" it.

### `tests/validation.test.ts`

- **`:154`–`:169`, the whole `createEventSchema` block** (3 tests: valid date, timestamp-masquerading-as-date, impossible calendar date) — every one parses an object with no `startTime` and will now fail on a required field rather than on the thing it is asserting. Add `startTime: '09:30'` to all three so each keeps testing its actual subject.

### `tests/api-export.test.ts`

- **`:92`** — asserts the full header line and a full data row as literal strings. Both change twice: `Service Time` after `Service Date` (Task 1.6) and `Recorded By Name` after `Recorded By` (Task 2.5). Update the literals, and update the inline `getExportRows` fixture object so `ExportRow` still type-checks.
- **`:164` SPEAKER row** — same fixture and same two new columns. Confirm a speaker row still carries an empty `Count` and now also a populated `Service Time`.
- Because both phases edit this one file, this is the concrete reason Tasks 1.6 and 2.5 must run sequentially rather than in parallel.

### `tests/actions-attendance.test.ts`

- **`:285` "hides recordedBy from a volunteer"** and **`:292` "includes recordedBy for an admin"** — already called out in Task 2.4. Rewrite to encode the new split (names for everyone, raw emails admin-only); do not delete.
- **`:160` "always derives recordedBy from the session"** — must pass **unchanged**. It is the security assertion this whole phase must not weaken. If a change to it seems necessary, that is a signal the implementation is wrong, not the test.
- Every `getEventSummary` / `getManageRows` / `getExportRows` fixture gains `recordedByName`, and `getExportRows`' `orderBy` assertion (if present) gains `startTime`.
- **The `eventFindMany` mock fixtures for `getExportRows` (around `:331` and `:400`) need `startTime: '09:30'`.** They mock whole `Event` rows and currently carry only `id`/`name`/`serviceDate`/`isArchived`/`records`. Without the field, `getExportRows` reads `event.startTime` as `undefined` and emits `serviceTime: undefined` — which does **not** throw, so the test stays green while producing a broken CSV column. This is the silent-failure class the inventory exists to catch. The `:329` test's name ("the full 9-field shape") also goes stale once `serviceTime` and `recordedByName` land — rename it and update the field count.

### `tests/actions-allowlist.test.ts`

- **`:62` `listAllowlist`** — asserts only the returned value, so Task 2.6's `orderBy` change does not break it. Note the display name is now `adminOverrideName ?? name`, which Postgres will not sort on directly — either order with `COALESCE` in raw SQL or sort in memory after the fetch; the list is capped small enough that in-memory is fine. **Add** an explicit `orderBy` assertion anyway: Phase 3's grouping depends on that ordering, and it is currently untested.

### `tests/auth.test.ts`

- **`:67`/`:77` googleSub binding** — these assert **database state**, not call shape, so collapsing the two writes into one `update` (Task 2.2) leaves them green. Verified, not assumed. Task 2.2's new name tests belong in this same file and this same real-DB style — do not introduce a mocked parallel file for auth.

### `e2e/counting-flow.spec.ts`

- **`:8`** — `getByRole('button', { name: /start counting today.s service/i })`. Task 1.4 relabels that button to include the service time ("Start counting — 9:30 AM") and replaces it entirely with per-service buttons when a date has more than one. **This selector will not match.** Update it as part of Task 1.4, in the same change that relabels the button, and keep the existing single-service assertion as the zero-or-one-service case alongside the new multi-service test.

## Verification

### Automated
- `npm run lint && npm test && npx tsc --noEmit` green after every task. "Green" means the regression inventory above has been worked through — a suite that passes because a fixture was loosened is not green.
- **Run the real-database tests, not just the mocked ones.** Most of this suite mocks Prisma; `tests/prisma-schema.test.ts` and `tests/auth.test.ts` do not, and Task 1.1's NOT NULL column is invisible to every mocked test in the project.
- `npm run security:sast` before opening a PR.
- Add one Playwright assertion to `e2e/counting-flow.spec.ts` covering the two-services-on-one-date path: create two services at different times, confirm the dashboard offers a choice rather than auto-redirecting, and confirm counts entered into one do not appear in the other. This is the regression that Task 1.4 exists to prevent, and it is exactly the kind of high-risk flow AGENTS.md says to e2e. Use `npm run test:e2e:local` (disposable Docker Postgres) — a bare `npm run test:e2e` writes fixtures into the real Neon dev database.

### Manual checklist (owner)
- [ ] Create two services on the same date at 9:30 AM and 11:00 AM; confirm they list in time order, not alphabetical.
- [ ] From the dashboard with both present, confirm you are asked which service — not silently routed into one.
- [ ] Edit the 11:00 service to 11:15; confirm ordering, entry/report headings, and the CSV all update.
- [ ] Take a service that already has counts entered, move it to a **past** date, and confirm the counts travel with it and the report still reads correctly.
- [ ] Enter and correct counts on that past-dated service — confirm no date-based restriction blocks you.
- [ ] Try moving a service onto a date that already has a service of the same name; confirm you get the friendly collision message inline, not an error page, and that the original service is left untouched.
- [ ] Confirm an archived service offers no Edit control, and that unarchive → edit → re-archive works.
- [ ] Enter counts as one user and check the report shows that person's **name**; sign in as a second user, enter a different category, confirm both names appear.
- [ ] Sign in as a volunteer and confirm names are visible but email addresses are not.
- [ ] Override a name in Settings, sign that person out and back in, confirm the override survives.
- [ ] Confirm a printed report still lays out correctly with the new time and "Recorded by" column.
- [ ] Confirm the allowlist groups collapse/expand, that Revoked starts collapsed, and that you still cannot revoke yourself or the last admin.

## Ordering and dependencies

Phase 1 and Phase 2 are independent and can proceed in parallel, with one exception: both touch `src/lib/actions/attendance.ts`'s `getExportRows` and both add a CSV column, so run Tasks 1.6 and 2.5 sequentially, not concurrently. Phase 3 depends on Task 2.6 (`Allowlist.name` and the edit action) and should land last. Phase 1 Task 1.4 is the highest-priority item in the whole plan — it fixes an active miscounting risk, not a missing feature — and should ship first even if the rest slips.

Note that Task 1.3's `updateEventSchedule` and Task 1.1's required-`startTime` migration are coupled: until the migration lands, there is no `startTime` to edit, so 1.1 → 1.2 → 1.3 is a strict sequence. Task 1.4 depends only on 1.1.
