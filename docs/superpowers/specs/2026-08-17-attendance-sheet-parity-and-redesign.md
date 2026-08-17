# Attendance sheet parity & accessible redesign

**Date:** 2026-08-17
**Status:** Approved, pending implementation plan

## Motivation

Two independent asks converged into one piece of work:

1. The app's tracked categories don't match the church's real paper attendance sheet ("Manna Church Capital Area Attendance Sheet"). Several real fields — Salvations, Connection Cards, Growth Track, Welcome Packs Given, a headcount for people outside the main room — aren't tracked at all, and some tracked categories (Balcony, the named classrooms, part of the SERVE Team list) don't match what's actually on the sheet.
2. The visual design needs an accessibility pass: current contrast is too low, text/numbers are too small, and status color-coding (the existing red/green danger/success pair) isn't distinguishable for colorblind users.

This spec covers both together since they touch the same screens and the data changes need to land before the visual polish is worth doing.

## Data model changes

### `CategoryType` enum

Add two new values: `GROWTH_TRACK` and `SERVICE_METRIC`. Existing values (`SECTION`, `CLASSROOM`, `SERVE_TEAM`) are unchanged.

### `Category` model

Add `countsTowardTotal Boolean @default(true)`. Existing categories keep counting by default — no behavior change for them. Set explicitly to `false` only on the 4 new `SERVICE_METRIC` categories (see table below). This flag is set once at category creation and is not editable afterward, matching the existing convention that `type` is also immutable post-creation (no `renameCategory`-style edit action exists for categories today, per an earlier project decision — see `.superpowers/sdd/2026-08-09-church-attendance-app-plan/progress.md`, Task 12).

### Admin UI (Settings page)

The "add category" form gets one new field: a checkbox, **"Counts toward Total Attendance,"** checked by default. This is the only new admin-facing surface this spec introduces.

### Final category list

| Group | `CategoryType` | Items | `countsTowardTotal` | UI treatment |
|---|---|---|---|---|
| Sanctuary | `SECTION` | Left Wing, Center Left, Center Right, Right Wing | `true` | Tap-card grid (sanctuary map), left-to-right in that order |
| Sanctuary | `SECTION` | Out of Service Total | `true` | List row below the map grid (same pattern SERVE Team already uses for non-mapped items) |
| Classrooms | `CLASSROOM` | 0-2, 3-5, 6-11 | `true` | Tap-card grid |
| Growth Track | `GROWTH_TRACK` | First Step, Next Step, Leadership Step | `true` | Tap-card grid, own heading (same visual treatment as Classrooms, not nested inside it) |
| SERVE Team | `SERVE_TEAM` | Parking, Hospitality, Welcome, Mana Kids, Host, Production, Worship, Guardians | `true` | List rows |
| Ministry Metrics | `SERVICE_METRIC` | Salvations, Connection Cards Given, Connection Cards Returned, Welcome Packs Given | `false` | List rows, dashed border, group subtitle "(not counted in attendance)" |

**Retired** (soft-deleted via `isActive: false`, never hard-deleted — existing `AttendanceRecord` rows stay intact under `onDelete: Restrict`): Balcony, Nursery, Older Children's Classroom, Middle Age Classroom, Coffee, Kids Center.

Note on naming: "Mana Kids" (single n) was requested explicitly, though the paper sheet spells the ministry "Manna Kids" (double n) elsewhere. Flagged once during design; proceeding with "Mana Kids" as instructed.

### Total Attendance calculation

Changes from "sum every category" to "sum every category where `countsTowardTotal` is true." Same call site (`getEventSummary` / wherever the report's total is computed), filtered instead of unconditional.

## Migration approach

Nothing is deployed yet (Task 15 — deploy, repo settings, threat model — is still pending in the original 15-task plan, no production data exists). This is a seed-script rewrite, not a data-preserving migration:

1. Prisma migration adds `GROWTH_TRACK` and `SERVICE_METRIC` to `CategoryType`, adds `countsTowardTotal Boolean @default(true)` to `Category`.
2. `prisma/seed.ts` deactivates the 6 retired categories listed above and upserts the final category list.
3. Manual-testing data entered against the old categories (during the 2026-08-16 verification session) stays attached to their now-inactive categories — harmless dev-only residue, not a concern for a pre-launch app.

## Visual design system

### Direction

Accessibility-driven, not a brand-identity overhaul. The app stays visually generic (no hardcoded church name/branding, by explicit decision) — the redesign's "signature" is functional: every status that currently relies on color alone (save success/error) gets paired with an icon or shape, not just a hue change. The Ministry Metrics group's dashed border (vs. solid elsewhere) is the same principle applied to grouping.

### Token system

Extend the existing CSS custom-property system (`src/styles/tokens.css`) in place — no new UI framework or dependency. Default `:root` becomes the light palette; a `prefers-color-scheme: dark` block redefines the dark palette. Every component already reads colors via `var(--color-*)`, so this propagates without touching component code.

Palette is drawn from Okabe–Ito (a colorblind-safe qualitative palette), replacing the old gold accent and red/green danger/success pair:

| Token | Light | Dark |
|---|---|---|
| `--color-bg` | `#F7F8FA` | `#0F1115` |
| `--color-surface` | `#FFFFFF` | `#181B22` |
| `--color-border` | `#D5D9E0` | `#3A4150` |
| `--color-text` | `#14161A` | `#F5F7FA` |
| `--color-text-muted` | `#4A505C` | `#B8C0CC` |
| `--color-accent` | `#0072B2` | `#56B4E9` |
| `--color-danger` | `#D55E00` | `#FF8A3D` |
| `--color-success` | `#009E73` | `#33D6A6` |

Target WCAG AA contrast (4.5:1 body text, 3:1 large text/UI elements) — verify with a contrast-checking script during implementation rather than eyeballing it; adjust any token that fails before shipping.

### Type scale

Base sizes increase across the board — labels/body text up roughly one step (e.g. base 1rem → 1.125rem), counter numbers in the tap dialog increase toward ~3.5rem. Exact scale finalized during implementation against the existing `--text-*` token names in `tokens.css`.

### Layout reference

See the approved mockup for full entry-screen layout (all 5 groups, ordering, and light/dark side-by-side) — captured during the brainstorming session's visual companion, screens `theme-entry-screen-v7.html` onward.

## Testing

- New Vitest coverage for the total calculation: headcount categories (`SECTION`, `CLASSROOM`, `GROWTH_TRACK`, `SERVE_TEAM`) sum into the total; `SERVICE_METRIC` categories do not.
- New Vitest coverage for the seed script's deactivate-then-upsert migration (retired categories end up `isActive: false`, new categories exist with correct `type`/`countsTowardTotal`).
- No new Playwright coverage needed — Task 14's authorization smoke tests are unaffected by this change (it doesn't touch auth/authz).
- Manual verification: re-run the same three checks done in the 2026-08-16 testing session (persistence/draft-recovery, `/settings` authorization boundary, print preview) after this change lands, since the category list and visual tokens touch the same screens.

## Non-goals / out of scope

- No church-specific branding (name, logo) added to the UI — explicit decision to keep the app generic.
- No admin UI to edit `countsTowardTotal` (or `type`) on an *existing* category after creation — consistent with the app's existing no-edit-after-create convention for categories.
- No new dependency or UI framework for theming — token-system-only.
- Task 15 (deploy, repo settings, threat model) is unaffected and unblocked by this work, but not addressed by it either.
