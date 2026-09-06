# Help page & shared app header

**Date:** 2026-08-31
**Status:** Approved, pending implementation plan

## Motivation

There is no help or guidance anywhere in the app, and no consistent navigation: Sign out
exists only on the dashboard, Help exists nowhere, and each page hand-rolls its own header.
Volunteers and admins have to figure the screens out cold. Decision (2026-08-31): fix both
with one task-oriented help page plus a shared header that gives every signed-in page the
same three anchors — home, Help, Sign out.

## Shared header — `src/components/AppHeader.tsx`

Rendered at the top of every signed-in page (`dashboard`, `entry/[eventId]`,
`report/[eventId]`, `report/[eventId]/manage`, `settings`, and the new `help`):

- **App name** ("Church Attendance") — links to `/dashboard`.
- **Help** — links to `/help#<anchor>`, where each page passes its own anchor via a
  `helpAnchor` prop (e.g. the entry page passes `counting`), so help opens scrolled to the
  relevant section. No anchor prop → plain `/help`.
- **Sign out** — the existing `SignOutButton`, unchanged, moved into the header. The
  dashboard's current one-off placement is removed in favor of this.

The dashboard's admin-only **Settings** link stays on the dashboard (page content, not
header — the header is identical for every role, which keeps it dumb and testable).
Page-specific header content (event name, Print/CSV/Manage buttons on the report page)
stays in the pages; `AppHeader` renders above it as a slim, consistent strip. It is a
server component with no data needs (role-independent by design).

Signed-out pages (`login`, `denied`) do not get the header. The login page gets one small
muted "How this app works" link to `/help`? — **No**: `/help` sits behind the sign-in wall
(the middleware already redirects signed-out visitors), and the denied page's existing
copy already tells an unauthorized visitor what to do. No help entry point for
signed-out users; keep those two pages as they are.

## Help page — `src/app/help/page.tsx`

A static server component (gated by `requireUserPage()`, same as every signed-in page —
content is identical for volunteers and admins; nothing on it is secret). Content lives in
the page file, written in plain church language, organized by task with stable anchor ids:

| Anchor | Section covers |
|---|---|
| `#counting` | Start counting today's service; tap a section/room; the +/− dialog; drafts surviving a refresh; why saving twice doesn't double-count |
| `#speakers` | Recording who's on the stage (lands with Phase 2b) |
| `#reports` | Reading the summary; what Total includes and excludes (ministry metrics); printing |
| `#manage` | (Admins) The Manage Records page; editing vs deleting a count; what delete really does |
| `#categories` | (Admins) Adding, reordering, renaming, hiding/showing, and deleting categories; what the map regions are |
| `#services` | (Admins) Creating and archiving services; what archiving means (lands with the settings redesign) |
| `#access` | (Admins) Authorizing emails, roles, and why revoking works instantly |
| `#export` | (Admins) CSV downloads — per-service and date-range |

Admin-only sections are labeled "(Admins)" in their headings rather than hidden — a
volunteer reading what admins can do is harmless and answers "who do I ask?".

Sections that describe not-yet-shipped features (`#speakers`, parts of `#categories`,
`#services`) are written in the same implementation task as those features land — the
initial help page ships with the sections for everything already live, and each later
phase's plan adds its section. The anchor names above are the contract.

## Testing

- No new unit tests (static content + a role-independent presentational header, per the
  project's UI-wiring convention).
- Manual: header present and identical on all six signed-in pages; Help deep-links land on
  the right section; Sign out works from a non-dashboard page; login/denied unchanged;
  print view of the report does not include the header (`no-print` on the header strip).

## Non-goals / out of scope

- No tooltips, guided tours, or first-run wizards.
- No per-role content filtering on the help page.
- No CMS or database-driven help content — it's code, reviewed like code.
- No search; the page is short enough to scroll.
