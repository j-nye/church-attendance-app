# Stage speakers

**Date:** 2026-08-31
**Status:** Approved, pending implementation plan

## Motivation

Each service has zero or more people on the stage (the speaker/preacher, guest speakers,
occasionally nobody notable to record). The paper sheet has a place for this; the app has
nothing. The sanctuary map already draws a **Stage** region (`src/lib/map-regions.ts`, key
`stage`) that is currently inert — no category maps to it, so it renders untappable. This
feature makes tapping the Stage record *names*, the same gesture volunteers already use to
record counts everywhere else on the map.

Names are not counts, so this does not bend `AttendanceRecord` — it gets its own model.

## Decisions (2026-08-31)

- **Structured list**: one database row per speaker per service, added/removed individually
  in a dialog. Not a free-text field.
- **Volunteer-recordable**: same trust level as counts — `requireUser()`, not
  `requireAdmin()`. Archived services reject writes with the same message counts use.
- **Displayed on the report page and in the CSV export**, in addition to the entry screen.

## Data model

```prisma
/// A person on the stage for a service. Zero or more per event.
model ServiceSpeaker {
  id         String   @id @default(cuid())
  eventId    String
  /// Display name as entered. Trimmed; uniqueness is per event.
  name       String
  /// Email of the signed-in user, always derived server-side from the session.
  recordedBy String
  createdAt  DateTime @default(now())

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, name])
  @@index([eventId])
}
```

- `onDelete: Cascade` matches `AttendanceRecord`'s relationship to `Event`.
- `@@unique([eventId, name])` prevents duplicate entries of the same name for one service;
  adding an existing name is a friendly no-op, not an error (mirrors the upsert idempotency
  convention for counts).
- Display order is `createdAt asc` — the order they were added.

## Server actions — new file `src/lib/actions/speakers.ts`

All follow the codebase conventions: `requireUser()` first, Zod parse, fetch-and-validate
the event, `revalidatePath` after mutations.

- `listSpeakers(eventId)` — `requireUser()`; returns the event's speakers ordered by
  `createdAt asc`. Used by the entry page (initial data) and anywhere else that needs them.
- `addSpeaker(input)` — `requireUser()`; parses `{ eventId, name }` with a new
  `addSpeakerSchema` (`idSchema` + `speakerNameSchema`: trimmed, min 1, max 80). Rejects a
  missing/archived event with the existing message `'That service is not accepting counts'`.
  Creates the row with `recordedBy` from the session; a `P2002` unique violation (name
  already present) is caught and treated as success — idempotent, like a double-tapped
  count. Revalidates `/entry/<eventId>` and `/report/<eventId>`.
- `removeSpeaker(input)` — `requireUser()`; parses `{ eventId, speakerId }`. Same
  archived-event rejection. `deleteMany({ where: { id: speakerId, eventId } })` — the
  `eventId` in the where-clause means a valid-looking speaker id from a different event
  deletes nothing (never trust that a valid ID implies access), and an already-removed
  speaker is a harmless no-op. Revalidates the same two paths.

Speaker removal is a low-stakes correction of a list that is re-editable at any time — it
does **not** write to `AuditLog` (that precedent is for destroying attendance facts).

## UI

### Entry screen

- The Stage region in `SanctuaryMap` becomes tappable even though no category maps to it.
  `SanctuaryMap` gets an optional `onSelectStage?: () => void` prop plus an optional
  `speakerCount?: number` for its label; when provided, the stage region renders as a
  button showing the label "Stage" and either the speaker names' count (e.g. "2 speakers")
  or "—" when empty, with the same recorded/unrecorded stroke treatment sections use
  (accent stroke when at least one speaker is recorded).
- Tapping Stage opens a new `SpeakerDialog` (client component, modeled on `CounterDialog`'s
  overlay structure and accessibility attributes): a list of current names each with a
  Remove button, a text input + Add button for a new name, and a Close button. Add/Remove
  call the server actions directly and update local state on success; failures show the
  same loud inline error pattern `CounterDialog` uses (icon + message, no silent failure).
  There is no draft/localStorage persistence — unlike a count mid-tally, a name is a single
  short entry with nothing to lose on refresh.

### Report page

A "Speakers" line under the event header on `/report/<eventId>`: names joined with
commas, or `—` when none. Included in the printed summary (no `no-print` class).

### CSV export

`getExportRows` (or the route) appends one row per speaker after each event's attendance
rows, reusing the existing 9 columns unchanged:

| Column | Value for a speaker row |
|---|---|
| Service Date / Service Name / Archived | as the event |
| Category Type | `SPEAKER` |
| Group | `Stage` |
| Category | the speaker's name |
| Count | empty string |
| Counts Toward Total | `false` |
| Recorded By | the recording user's email |

Existing consumers keep their column layout; speaker rows are additive and identifiable by
`Category Type = SPEAKER`.

## Testing

- `tests/validation.test.ts`: `addSpeakerSchema` (accepts a normal name, trims, rejects
  empty/whitespace-only, rejects > 80 chars), `removeSpeakerSchema`.
- New `tests/actions-speakers.test.ts` (mock structure mirroring
  `tests/actions-attendance.test.ts`): each action requires a user; archived/missing event
  rejection; `addSpeaker` creates with session-derived `recordedBy` and treats `P2002` as
  success; `removeSpeaker` scopes the delete by both `id` and `eventId` and tolerates
  zero matches; revalidation paths.
- `tests/actions-attendance.test.ts` / `tests/api-export.test.ts`: extended for speaker
  rows in the export (ordering after attendance rows, the exact 9-field shape above).
- Manual: record two speakers, remove one, verify entry-screen label, report line, print
  view, and CSV rows; verify a volunteer can add/remove and an archived service refuses.

## Non-goals / out of scope

- No speaker directory, autocomplete, or linkage to the Allowlist — names are plain text.
- No audit trail for speaker add/remove.
- No admin manage-view integration — the entry screen's dialog is the editor. (The manage
  page is for attendance records; extending it to speakers is future work if ever needed.)
- No cap on the number of speakers.
- No change to the Total Attendance calculation — speakers are people, not counts.
