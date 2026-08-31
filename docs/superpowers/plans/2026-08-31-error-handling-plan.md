# Error Handling UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for implementation.

**Goal:** Give the app real error handling UX for the two failure modes that currently fall through to Next's raw error screen: (1) an admin-only page whose page-level `requireAdmin()` throws `AuthzError` — a signed-in volunteer who opens `/settings` or `/report/[eventId]/manage` should land on the existing `/denied` page instead of a crash, and a genuinely unexpected error anywhere in the app should get a friendly generic fallback with a retry button; (2) the two "add" forms on `/settings` (add category, authorize an email) currently throw on expected, everyday mistakes (blank name, malformed email, a duplicate category name+type) — they should render the problem inline instead of crashing. This is Phase 2 of `docs/superpowers/plans/2026-08-31-roadmap.md`, covering its first two bullets only. The roadmap's third Phase 2 bullet, the sign-out button, already shipped separately (`f8f002e`) and is out of scope here.

**Architecture:**

- **Page-level authz redirect, not `error.tsx`, not `forbidden()`.** Two new helpers in `src/lib/authz.ts` — `requireUserPage()` and `requireAdminPage()` — wrap the existing `requireUser()`/`requireAdmin()`, catch only `AuthzError`, and call `redirect('/denied')` *server-side, before any React tree (and therefore any error boundary) ever mounts*. Every non-`AuthzError` is rethrown untouched, so a real bug still reaches `error.tsx`. All five page-level gates (`dashboard`, `entry/[eventId]`, `report/[eventId]`, `settings`, `report/[eventId]/manage`) switch to the `*Page()` variant. This generalizes past the two pages named in the roadmap bullet (`/settings`, `/report/[eventId]/manage`) to every page-level gate, because the underlying problem — "a signed-in user whose access no longer matches the page gets Next's raw error screen" — is identical for `requireUser()` call sites (e.g. a volunteer deactivated mid-session hitting `/dashboard`) as it is for `requireAdmin()` ones. This does **not** change the Server Action boundary: every Server Action still calls `requireUser()`/`requireAdmin()` directly and still throws `AuthzError` on failure, per AGENTS.md — only the five *page* components change.
- **`src/app/error.tsx`** is the app-level Client Component boundary for genuinely unexpected errors — a bug, a DB outage, anything that isn't `AuthzError` and wasn't redirected away above. It renders a generic "Something went wrong" card with a retry button. It never reads `error.message` and never does `error instanceof AuthzError` — Next.js masks `error.message` for Server Component/Server Action errors in production (see Global Constraints), so any design that branches on it would work in `next dev` and silently stop working in production. The retry button uses the `retry()` prop, which the installed Next.js 16.3.0 promoted from `unstable_retry` to a stable API (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, Version History: "`v16.3.0` | `retry` prop became stable."). `reset()` still exists but the same doc recommends `retry()` "in most cases," since `reset()` only clears local state without re-fetching and won't recover a failed Server Component render.
- **Two new Client Components** (`src/components/AddCategoryForm.tsx`, `src/components/AddAllowlistForm.tsx`), each driven by React 19's `useActionState`, replace the two inline `'use server'`-closure forms on `/settings`. Each is wired to a new small **wrapper** Server Action — `createCategoryAction` in `src/lib/actions/categories.ts`, `addAllowlistEntryAction` in `src/lib/actions/allowlist.ts` — that calls the existing, unchanged `createCategory`/`addAllowlistEntry`, catches only *expected* failures (a Zod validation error, a Prisma `P2002` unique-constraint violation, or a stale/revoked admin session's `AuthzError`), and returns `{ ok: false, message }`. Anything else is rethrown so `error.tsx` still catches it. The existing `createCategory`/`addAllowlistEntry`/`deactivateCategory`/`deactivateAllowlistEntry` keep their current throwing contracts byte-for-byte — other callers and `tests/actions-categories.test.ts`/`tests/actions-allowlist.test.ts` depend on that.
- **A shared `friendlyValidationMessage()` helper** in `src/lib/validation.ts` turns a raw `ZodError` into one short, field-aware sentence (`"Name is required."`, not Zod 4's `"Too small: expected string to have >=1 characters"`), so both wrapper actions produce readable text instead of a raw issue dump.
- **The Retire/Revoke buttons and `CounterDialog` are untouched.** Only the two "add" forms move to Client Components; the two "remove" actions stay exactly as the inline `'use server'` closures they already are.

**Tech Stack:** Next.js 16.3.0 App Router (Server Components + Server Actions, `error.js` file convention), React 19.2.8 (`useActionState`), Zod 4.4.3, Prisma 6.19.3 (`Prisma.PrismaClientKnownRequestError`, code `P2002`), Vitest.

**Roadmap:** `docs/superpowers/plans/2026-08-31-roadmap.md`, Phase 2, bullets 1–2 (bullet 3, sign-out, shipped separately in `f8f002e`).

---

## Investigation: why not `forbidden()` / `unauthorized()`?

The task brief asked specifically to check whether Next's `forbidden()`/`unauthorized()` functions and their `forbidden.tsx`/`unauthorized.tsx` file conventions are stable in 16.3.0 and would fit better than a catch-and-redirect. They were **rejected** after reading the installed docs:

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md` — front-matter `version: experimental`, unchanged since `v15.1.0` (see its Version History table). The doc's own instructions require enabling `experimental.authInterrupts` in `next.config.ts` before `forbidden`/`unauthorized` can be imported from `next/navigation` at all.
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/authInterrupts.md` — front-matter `version: canary`. Still gated behind an experimental flag in the installed 16.3.0 docs tree, three-plus minor versions after introduction.
- This repo's `next.config.ts` does **not** set `experimental.authInterrupts` (confirmed by reading the file — it's the default `create-next-app` stub with no `experimental` block at all).

Given AGENTS.md's own warning that this codebase already runs bleeding-edge (Next 16.3.0, React 19.2.8, next-auth v5-beta) and to "test locally" rather than assume stability, adding a second experimental/canary flag on top of that is an avoidable risk for a page-count this small (five page-level gates, one shared helper). The catch-and-redirect pattern in the Architecture section above is Option (b) from the task brief, is already the pattern `/settings` used informally (`// Page-level gate ... this call is convenience, not the boundary`), and needs no config change. **If the project later enables `authInterrupts` for other reasons, `requireAdminPage()`/`requireUserPage()` can be swapped for `forbidden()`/`unauthorized()` calls without touching any of the five page files that consume them** — the indirection point already exists.

## Global Constraints

- `requireUserPage()`/`requireAdminPage()` only ever intercept `AuthzError`. Every other exception — a real bug, a Prisma connection failure, anything — is rethrown untouched so `src/app/error.tsx` still catches it. Never widen the `catch` to a bare `catch {}` or `catch (error) { redirect(...) }` without the `instanceof AuthzError` guard.
- `src/app/error.tsx` never inspects `error.message` and never does `error instanceof AuthzError` (or any other `instanceof` check). Per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`: *"Errors forwarded from Server Components show a generic message with an identifier[, to] prevent leaking sensitive details."* In production, every Server Component/Server Action error arrives at `error.tsx` looking identical (`error.message` is a generic placeholder, `error.digest` is the only identifying field) — a design that branches on `error.message` or a class check will work under `next dev` and silently do nothing in production. `error.tsx` renders one static fallback UI plus a `retry()` button, full stop.
- No `forbidden()`, `unauthorized()`, `forbidden.tsx`, `unauthorized.tsx`, or `experimental.authInterrupts` anywhere in this plan — see the Investigation section above.
- `createCategory`, `deactivateCategory`, `addAllowlistEntry`, `deactivateAllowlistEntry` keep their exact current signatures and throwing behavior. The new wrapper actions (`createCategoryAction`, `addAllowlistEntryAction`) are additive, call the existing functions, and do not change them. `tests/actions-categories.test.ts` and `tests/actions-allowlist.test.ts`'s existing `describe` blocks must still pass unmodified.
- **`addAllowlistEntry` has no duplicate-email error path to catch.** It `upsert`s on the unique `email` column (`src/lib/actions/allowlist.ts`), so re-submitting an email that's already on the allowlist is a normal update (e.g. changing that person's role from VOLUNTEER to ADMIN), not a Prisma `P2002` violation — Prisma's `upsert` only ever hits its `create` branch when the row is absent. `addAllowlistEntryAction` therefore only catches `AuthzError` and `ZodError`; it has no `P2002` branch. (See "Conflicts found" below — this is called out explicitly because the task brief's failure list named "duplicate allowlist email" as an expected failure alongside "duplicate category name," but the two forms are not actually symmetric in the existing code.)
- `createCategoryAction` **does** need a `P2002` branch: `createCategory` calls `prisma.category.create` directly (`src/lib/actions/categories.ts`), and `Category` has `@@unique([name, type])` (`prisma/schema.prisma`), so a duplicate name+type genuinely throws today.
- `CounterDialog` (`src/components/CounterDialog.tsx`) is not touched by this plan. Its existing loud, `role="alert"` + `⚠` retry-on-save-failure behavior is the reference pattern this plan's inline form errors reuse — not something to change.
- Retire/Revoke stay exactly as the inline `<form action={async () => { 'use server'; ... }}>` closures they already are in `src/app/settings/page.tsx`. Only the two "add" forms move into Client Components.
- Every new inline error message pairs `--color-danger` with an `aria-hidden="true"` `⚠` glyph and `role="alert"`, matching `CounterDialog`'s existing colorblind-safe convention (color is never the only signal).
- `friendlyValidationMessage()` is intentionally narrow — it knows about exactly the fields these two forms submit (`name`, `type`, `email`, `role`) and falls back to a generic "That field is not valid." for anything else. It is not a general-purpose Zod formatter.

## Conflicts found between the task brief and the codebase

1. **"Duplicate allowlist email" is not an error in the current code.** `addAllowlistEntry` upserts on `email`, so resubmitting an existing address updates that row's role instead of throwing. There is no Prisma unique-constraint violation to catch for this form. Resolution taken in this plan: `addAllowlistEntryAction` only handles `AuthzError` and `ZodError` (invalid/malformed email, missing role); the "duplicate" case simply keeps working as a silent, successful role-update, matching the pre-existing behavior of `addAllowlistEntry` (not something this plan should change — changing `addAllowlistEntry`'s upsert semantics is out of scope for an error-handling-UX plan and would need its own spec/decision). Flagging this explicitly rather than fabricating a `P2002` branch that would never fire.
2. **`forbidden()`/`unauthorized()` are still experimental/canary in the installed 16.3.0 docs, not stable**, and the repo has not opted into `experimental.authInterrupts`. The task brief asked to verify this before choosing a mechanism; the Investigation section above documents the doc evidence. No conflict with the *decision* here (the brief listed the page-level-wrapper redirect as an acceptable fallback, Option (b)) — flagging it because the brief's phrasing ("investigate whether ... they exist and are stable") implied stability was genuinely open, and the answer is a clear no.
3. **No other conflicts found.** The `error.tsx` prop rename/stabilization (`retry` over `reset`) is a version-specific detail, not a conflict with the brief's constraints — the brief already anticipated `error.tsx` being "only the generic unexpected-failure fallback with a reset() retry button" and `retry()` is that same button under 16.3.0's now-stable name; this plan uses `retry()` per the current docs rather than the brief's literal `reset()` wording, since `reset()` is documented as the one to avoid "in most cases."

---

### Task 1: `requireUserPage()` / `requireAdminPage()` and applying them to all five page gates

**Files:**
- Modify: `src/lib/authz.ts`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/entry/[eventId]/page.tsx`
- Modify: `src/app/report/[eventId]/page.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/report/[eventId]/manage/page.tsx`
- Test: `tests/authz.test.ts` (extend)

**Interfaces:**
- Consumes: `requireUser()`, `requireAdmin()`, `AuthzError` (all already in `src/lib/authz.ts`); `redirect` from `next/navigation`.
- Produces: `requireUserPage(): Promise<CurrentUser>` and `requireAdminPage(): Promise<CurrentUser>` (exported from `src/lib/authz.ts`) — consumed by all five page files below.

- [x] **Step 1: Write the failing tests**

Extend `tests/authz.test.ts`. Add a `next/navigation` mock near the top, after the existing `vi.mock` calls (its `redirect` throws, exactly like the real one, so a test asserting "no crash" can't accidentally pass just because the mock silently returns):

```ts
const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (...args: [string]) => redirectMock(...args),
}))
```

Update the import line:

```ts
const { requireUser, requireAdmin, requireUserPage, requireAdminPage, AuthzError } = await import(
  '@/lib/authz'
)
```

Add `redirectMock.mockClear()` to the `beforeEach` block, alongside the existing resets.

Add two new `describe` blocks at the end of the file:

```ts
describe('requireUserPage', () => {
  it('redirects to /denied on AuthzError instead of throwing it to the caller', async () => {
    authMock.mockResolvedValue(null)
    await expect(requireUserPage()).rejects.toThrow('NEXT_REDIRECT:/denied')
    expect(redirectMock).toHaveBeenCalledWith('/denied')
  })

  it('rethrows a non-AuthzError untouched so error.tsx still catches real bugs', async () => {
    authMock.mockRejectedValue(new Error('database is on fire'))
    await expect(requireUserPage()).rejects.toThrow('database is on fire')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('returns the user unchanged on success, without redirecting', async () => {
    authMock.mockResolvedValue({ user: { email: 'vol@example.com' } })
    findUnique.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER', isActive: true })
    await expect(requireUserPage()).resolves.toEqual({ email: 'vol@example.com', role: 'VOLUNTEER' })
    expect(redirectMock).not.toHaveBeenCalled()
  })
})

describe('requireAdminPage', () => {
  it('redirects to /denied when a signed-in volunteer opens an admin page', async () => {
    authMock.mockResolvedValue({ user: { email: 'vol@example.com' } })
    findUnique.mockResolvedValue({ email: 'vol@example.com', role: 'VOLUNTEER', isActive: true })
    await expect(requireAdminPage()).rejects.toThrow('NEXT_REDIRECT:/denied')
    expect(redirectMock).toHaveBeenCalledWith('/denied')
  })

  it('rethrows a non-AuthzError untouched', async () => {
    authMock.mockRejectedValue(new Error('database is on fire'))
    await expect(requireAdminPage()).rejects.toThrow('database is on fire')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('returns the user unchanged for an admin, without redirecting', async () => {
    authMock.mockResolvedValue({ user: { email: 'boss@example.com' } })
    findUnique.mockResolvedValue({ email: 'boss@example.com', role: 'ADMIN', isActive: true })
    await expect(requireAdminPage()).resolves.toEqual({ email: 'boss@example.com', role: 'ADMIN' })
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
npm test -- authz
```

Expected: FAIL — `requireUserPage`/`requireAdminPage` are not exported from `@/lib/authz`, so the destructured import is `undefined` and calling it throws a `TypeError`.

- [x] **Step 3: Implement the helpers**

In `src/lib/authz.ts`, add the import and the two new functions at the end of the file:

```ts
import { redirect } from 'next/navigation'
```

(add alongside the existing `import { auth } from '@/lib/auth'` / `import { prisma } from '@/lib/prisma'` lines)

```ts
/**
 * Page-level convenience wrapper around requireUser(): on AuthzError,
 * redirects to the existing /denied page server-side — before any client
 * component (and therefore any error boundary) ever mounts — instead of
 * leaving Next's raw (and in production, masked) error screen as the only
 * outcome. Any other exception (a real bug, a DB outage) is rethrown
 * untouched so the app's error.tsx boundary still catches it.
 *
 * This is convenience, not the security boundary — every Server Action
 * called from the page re-checks requireUser()/requireAdmin() independently
 * per AGENTS.md, exactly as before this helper existed.
 */
export async function requireUserPage(): Promise<CurrentUser> {
  try {
    return await requireUser()
  } catch (error) {
    if (error instanceof AuthzError) redirect('/denied')
    throw error
  }
}

/** Same as requireUserPage(), but for admin-only pages. */
export async function requireAdminPage(): Promise<CurrentUser> {
  try {
    return await requireAdmin()
  } catch (error) {
    if (error instanceof AuthzError) redirect('/denied')
    throw error
  }
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
npm test -- authz
```

Expected: PASS, all tests in the file including the 6 new ones.

- [x] **Step 5: Switch all five page-level gates to the `*Page()` variants**

In `src/app/dashboard/page.tsx`, change:

```ts
import { requireUser } from '@/lib/authz'
```

to:

```ts
import { requireUserPage } from '@/lib/authz'
```

and change:

```ts
  const user = await requireUser()
```

to:

```ts
  const user = await requireUserPage()
```

In `src/app/entry/[eventId]/page.tsx`, change:

```ts
import { requireUser } from '@/lib/authz'
```

to:

```ts
import { requireUserPage } from '@/lib/authz'
```

and change:

```ts
  await requireUser()
```

to:

```ts
  await requireUserPage()
```

In `src/app/report/[eventId]/page.tsx`, change:

```ts
import { requireUser } from '@/lib/authz'
```

to:

```ts
import { requireUserPage } from '@/lib/authz'
```

and change:

```ts
  const [user, { event, rows, totals }] = await Promise.all([requireUser(), getEventSummary(eventId)])
```

to:

```ts
  const [user, { event, rows, totals }] = await Promise.all([requireUserPage(), getEventSummary(eventId)])
```

In `src/app/settings/page.tsx`, change:

```ts
import { requireAdmin } from '@/lib/authz'
```

to:

```ts
import { requireAdminPage } from '@/lib/authz'
```

and change:

```ts
  // Page-level gate. The actions below each re-check independently —
  // this call is convenience, not the boundary.
  await requireAdmin()
```

to:

```ts
  // Page-level gate. The actions below each re-check independently — this
  // call is convenience, not the boundary. On AuthzError it redirects to
  // /denied instead of leaving Next's raw error screen as the only outcome.
  await requireAdminPage()
```

In `src/app/report/[eventId]/manage/page.tsx`, change:

```ts
import { requireAdmin } from '@/lib/authz'
```

to:

```ts
import { requireAdminPage } from '@/lib/authz'
```

and change:

```ts
  // Page-level gate. getManageRows and deleteCount each re-check independently —
  // this call is convenience, not the boundary (same pattern as /settings).
  await requireAdmin()
```

to:

```ts
  // Page-level gate. getManageRows and deleteCount each re-check independently —
  // this call is convenience, not the boundary (same pattern as /settings). On
  // AuthzError it redirects to /denied instead of leaving Next's raw error
  // screen as the only outcome.
  await requireAdminPage()
```

- [x] **Step 6: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all passing — this step touches no Server Action logic, only page-level gates, so no existing test should be affected.

- [x] **Step 8: Commit**

```bash
git add src/lib/authz.ts tests/authz.test.ts src/app/dashboard/page.tsx "src/app/entry/[eventId]/page.tsx" "src/app/report/[eventId]/page.tsx" src/app/settings/page.tsx "src/app/report/[eventId]/manage/page.tsx"
git commit -m "feat: redirect to /denied on page-level AuthzError instead of crashing"
```

---

### Task 2: App-level `error.tsx` generic fallback

**Files:**
- Create: `src/app/error.tsx`

**Interfaces:**
- Consumes: nothing new — a plain Next.js `error.js` file convention component.
- Produces: the app-wide error boundary Next.js renders for any uncaught exception under the root layout that Task 1's redirects didn't already intercept.

This task is pure UI wiring with no business logic to unit test — matching this project's convention of not adding automated tests for pure UI composition (see `docs/superpowers/plans/2026-08-17-csv-export-plan.md` Task 5 and this plan's own Task 1, Step 5). Verification here is a type-check, the full suite staying green, and the manual checklist in Task 6.

- [x] **Step 1: Create the error boundary**

Create `src/app/error.tsx`:

```tsx
'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

/**
 * App-wide fallback for genuinely unexpected errors — anything that isn't an
 * AuthzError (those are redirected to /denied server-side in src/lib/authz.ts
 * before this ever mounts; see requireUserPage()/requireAdminPage()).
 *
 * Deliberately does NOT read error.message or check `error instanceof
 * AnythingSpecific`: in production, Next.js masks the message of any error
 * thrown in a Server Component or Server Action, forwarding only a generic
 * placeholder plus `error.digest` (see the "error.message" section of
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * A design that branches on the message or type would work in `next dev` and
 * silently stop working the moment this ships.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // The digest (if present) matches this instance to the server-side log
    // entry that has the real, unmasked error.
    console.error('Unhandled error', error.digest ? `(digest: ${error.digest})` : '', error)
  }, [error])

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '26rem' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginTop: 0 }}>Something went wrong</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          An unexpected error occurred. Nothing you had entered elsewhere on this page was lost —
          try again, and if it keeps happening, let a church administrator know.
        </p>
        <button
          onClick={() => retry()}
          style={{
            padding: '0 var(--space-4)', height: 'var(--tap-target)',
            background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700,
          }}
        >
          Try again
        </button>
      </div>
    </main>
  )
}
```

- [x] **Step 2: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean. This confirms the `retry` prop's type matches what Next.js 16.3.0 actually passes (per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, `retry` became the stable prop name in `v16.3.0`).

- [x] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all passing — this task adds no logic, only a new file.

- [x] **Step 4: Commit**

```bash
git add src/app/error.tsx
git commit -m "feat: add app-level error boundary with a retry fallback"
```

---

### Task 3: `friendlyValidationMessage()` helper

**Files:**
- Modify: `src/lib/validation.ts`
- Test: `tests/validation.test.ts` (extend)

**Interfaces:**
- Consumes: `z.ZodError` (from the `zod` package, already a dependency).
- Produces: `friendlyValidationMessage(error: z.ZodError): string` (exported from `src/lib/validation.ts`) — consumed by Task 4's `createCategoryAction` and Task 5's `addAllowlistEntryAction`.

- [x] **Step 1: Write the failing tests**

Add `friendlyValidationMessage` to the existing import line at the top of `tests/validation.test.ts`:

```ts
import {
  saveCountSchema,
  deleteCountSchema,
  categoryTypeSchema,
  createCategorySchema,
  createEventSchema,
  allowlistEntrySchema,
  friendlyValidationMessage,
  CATEGORY_NAME_MAX,
  serviceDateSchema,
} from '@/lib/validation'
```

Add a new `describe` block:

```ts
describe('friendlyValidationMessage', () => {
  it('reports a blank required field by name, not Zod\'s raw wording', () => {
    const { error } = createCategorySchema.safeParse({ name: '', type: 'SECTION' })
    expect(friendlyValidationMessage(error!)).toBe('Name is required.')
  })

  it('reports an invalid enum value by field name', () => {
    const { error } = createCategorySchema.safeParse({ name: 'Nursery', type: 'BOGUS' })
    expect(friendlyValidationMessage(error!)).toBe('Category type must be one of the listed options.')
  })

  it('reports a malformed email as an email problem', () => {
    const { error } = allowlistEntrySchema.safeParse({ email: 'not-an-email', role: 'ADMIN' })
    expect(friendlyValidationMessage(error!)).toBe("Email address doesn't look like a valid email address.")
  })

  it('reports an over-length email as too long', () => {
    const { error } = allowlistEntrySchema.safeParse({ email: `${'x'.repeat(300)}@example.com`, role: 'ADMIN' })
    expect(friendlyValidationMessage(error!)).toBe('Email address is too long.')
  })

  it('falls back to a generic message for a field it does not recognize', () => {
    const { error } = saveCountSchema.safeParse({ categoryId: 'c1', count: 1 }) // eventId missing entirely
    expect(friendlyValidationMessage(error!)).toBe('That field is required.')
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
npm test -- validation
```

Expected: FAIL — `friendlyValidationMessage` is not exported from `@/lib/validation`, so the import resolves to `undefined` and calling it throws a `TypeError`.

- [x] **Step 3: Implement `friendlyValidationMessage`**

In `src/lib/validation.ts`, add at the end of the file:

```ts
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
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
npm test -- validation
```

Expected: PASS, all 5 new tests plus the existing suite.

- [x] **Step 5: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 6: Commit**

```bash
git add src/lib/validation.ts tests/validation.test.ts
git commit -m "feat: add friendlyValidationMessage for readable inline form errors"
```

---

### Task 4: `createCategoryAction` wrapper and `AddCategoryForm`

**Files:**
- Modify: `src/lib/actions/categories.ts`
- Create: `src/components/AddCategoryForm.tsx`
- Modify: `src/app/settings/page.tsx`
- Test: `tests/actions-categories.test.ts` (extend)

**Interfaces:**
- Consumes: `createCategory` (existing, unchanged), `AuthzError` (`src/lib/authz.ts`), `friendlyValidationMessage` (Task 3), `Prisma.PrismaClientKnownRequestError` (`@prisma/client`), `MAP_REGIONS` (`src/lib/map-regions.ts`).
- Produces: `CategoryFormState` type and `createCategoryAction(prevState, formData): Promise<CategoryFormState>` (exported from `src/lib/actions/categories.ts`) and the `AddCategoryForm` component (exported from `src/components/AddCategoryForm.tsx`) — rendered by `/settings`.

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-categories.test.ts`. Add these imports at the top of the file, alongside the existing ones:

```ts
import { Prisma } from '@prisma/client'
```

Update the import line:

```ts
const {
  listActiveCategories,
  createCategory,
  deactivateCategory,
  createCategoryAction,
} = await import('@/lib/actions/categories')
```

Add a small local helper and a new `describe` block at the end of the file:

```ts
function categoryFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('createCategoryAction', () => {
  it('returns { ok: true } and creates the category for valid input', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockResolvedValue({ id: '1' })

    const result = await createCategoryAction({ ok: true }, categoryFormData({ name: 'Nursery', type: 'CLASSROOM' }))

    expect(result).toEqual({ ok: true })
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: 'Nursery', type: 'CLASSROOM', svgKey: null, countsTowardTotal: false },
    })
  })

  it('returns a friendly inline message instead of throwing for a blank name', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })

    const result = await createCategoryAction({ ok: true }, categoryFormData({ name: '', type: 'SECTION' }))

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message for a duplicate name+type instead of crashing', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`name`,`type`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['name', 'type'] },
      })
    )

    const result = await createCategoryAction(
      { ok: true },
      categoryFormData({ name: 'Nursery', type: 'CLASSROOM' })
    )

    expect(result).toEqual({ ok: false, message: 'A category with that name and type already exists.' })
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await createCategoryAction(
      { ok: true },
      categoryFormData({ name: 'Nursery', type: 'CLASSROOM' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(categoryCreate).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    categoryCreate.mockRejectedValue(new Error('connection reset'))

    await expect(
      createCategoryAction({ ok: true }, categoryFormData({ name: 'Nursery', type: 'CLASSROOM' }))
    ).rejects.toThrow('connection reset')
  })
})
```

Note: `AuthzError` in this test file already comes from the file's own local `class AuthzError` (see the top of `tests/actions-categories.test.ts`) that the `@/lib/authz` mock re-exports — no new import needed for it.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-categories
```

Expected: FAIL — `createCategoryAction` is not exported from `@/lib/actions/categories`.

- [ ] **Step 3: Implement `createCategoryAction`**

In `src/lib/actions/categories.ts`, add these imports at the top of the file, alongside the existing ones:

```ts
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { AuthzError } from '@/lib/authz'
import { friendlyValidationMessage } from '@/lib/validation'
```

Add at the end of the file:

```ts
export type CategoryFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around createCategory() for the settings
 * page's "Add a category" form. Catches only EXPECTED failures — invalid
 * input, a duplicate name+type (the schema's @@unique([name, type])
 * constraint), or a stale/revoked admin session — and turns them into an
 * inline { ok: false, message } the form renders without a crash. Anything
 * else (a real bug, a DB outage) is rethrown so the app's error.tsx boundary
 * still catches it. createCategory() itself keeps its existing throwing
 * contract unchanged — other callers and its own tests above depend on it.
 */
export async function createCategoryAction(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  try {
    await createCategory({
      name: formData.get('name'),
      type: formData.get('type'),
      svgKey: (formData.get('svgKey') as string) || null,
      countsTowardTotal: formData.get('countsTowardTotal') === 'on',
    })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'A category with that name and type already exists.' }
    }
    throw error
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-categories
```

Expected: PASS, all tests in the file including the 5 new ones.

- [ ] **Step 5: Create `AddCategoryForm`**

Create `src/components/AddCategoryForm.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createCategoryAction, type CategoryFormState } from '@/lib/actions/categories'
import { MAP_REGIONS } from '@/lib/map-regions'

const initialState: CategoryFormState = { ok: true }

export function AddCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategoryAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  // A successful add clears the (uncontrolled) form fields for the next
  // entry. A failed add leaves them exactly as typed, next to the message.
  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input name="name" placeholder="Name" required maxLength={60} style={{ padding: 'var(--space-3)' }} />
      <select name="type" required style={{ padding: 'var(--space-3)' }}>
        <option value="SECTION">Sanctuary section</option>
        <option value="CLASSROOM">Classroom</option>
        <option value="GROWTH_TRACK">Growth Track</option>
        <option value="SERVE_TEAM">Serve team</option>
        <option value="SERVICE_METRIC">Ministry metric</option>
      </select>
      <select name="svgKey" style={{ padding: 'var(--space-3)' }}>
        <option value="">Not on the map (shows in the list)</option>
        {MAP_REGIONS.map((region) => (
          <option key={region.key} value={region.key}>{region.label}</option>
        ))}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <input type="checkbox" name="countsTowardTotal" defaultChecked />
        Counts toward Total Attendance
      </label>
      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add category'}</button>
    </form>
  )
}
```

- [ ] **Step 6: Wire `AddCategoryForm` into the settings page**

In `src/app/settings/page.tsx`, add the import:

```ts
import { AddCategoryForm } from '@/components/AddCategoryForm'
```

Remove the now-unused import (this form's `MAP_REGIONS` usage moved into `AddCategoryForm` itself):

```ts
import { MAP_REGIONS } from '@/lib/map-regions'
```

Replace the "Add a category" `<form>` — from:

```tsx
        <form
          action={async (formData: FormData) => {
            'use server'
            await createCategory({
              name: formData.get('name'),
              type: formData.get('type'),
              svgKey: (formData.get('svgKey') as string) || null,
              countsTowardTotal: formData.get('countsTowardTotal') === 'on',
            })
          }}
          style={{ display: 'grid', gap: 'var(--space-3)' }}
        >
          <input name="name" placeholder="Name" required maxLength={60} style={{ padding: 'var(--space-3)' }} />
          <select name="type" required style={{ padding: 'var(--space-3)' }}>
            <option value="SECTION">Sanctuary section</option>
            <option value="CLASSROOM">Classroom</option>
            <option value="GROWTH_TRACK">Growth Track</option>
            <option value="SERVE_TEAM">Serve team</option>
            <option value="SERVICE_METRIC">Ministry metric</option>
          </select>
          <select name="svgKey" style={{ padding: 'var(--space-3)' }}>
            <option value="">Not on the map (shows in the list)</option>
            {MAP_REGIONS.map((region) => (
              <option key={region.key} value={region.key}>{region.label}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" name="countsTowardTotal" defaultChecked />
            Counts toward Total Attendance
          </label>
          <button type="submit">Add category</button>
        </form>
```

to:

```tsx
        <AddCategoryForm />
```

`createCategory` is still imported and used by `deactivateCategory`'s neighboring Retire form and by `createCategoryAction` inside `src/lib/actions/categories.ts` — no other change is needed to the settings page's existing `import { createCategory, deactivateCategory } from '@/lib/actions/categories'` line (only `createCategory`'s direct call site in the JSX moves out; the import itself becomes partially unused — see Step 7).

- [ ] **Step 7: Remove the now-unused `createCategory` import if the type-checker/linter flags it**

Since `createCategory` is no longer called directly from `src/app/settings/page.tsx` (it's now called from inside `createCategoryAction` in `categories.ts` instead), update the import line in `src/app/settings/page.tsx` from:

```ts
import { createCategory, deactivateCategory } from '@/lib/actions/categories'
```

to:

```ts
import { deactivateCategory } from '@/lib/actions/categories'
```

- [ ] **Step 8: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 9: Run the full test suite**

```bash
npm test
```

Expected: all passing, including the 5 new tests from Step 1.

- [ ] **Step 10: Commit**

```bash
git add src/lib/actions/categories.ts src/components/AddCategoryForm.tsx src/app/settings/page.tsx tests/actions-categories.test.ts
git commit -m "feat: render add-category form errors inline instead of crashing"
```

---

### Task 5: `addAllowlistEntryAction` wrapper and `AddAllowlistForm`

**Files:**
- Modify: `src/lib/actions/allowlist.ts`
- Create: `src/components/AddAllowlistForm.tsx`
- Modify: `src/app/settings/page.tsx`
- Test: `tests/actions-allowlist.test.ts` (extend)

**Interfaces:**
- Consumes: `addAllowlistEntry` (existing, unchanged), `AuthzError` (`src/lib/authz.ts`), `friendlyValidationMessage` (Task 3).
- Produces: `AllowlistFormState` type and `addAllowlistEntryAction(prevState, formData): Promise<AllowlistFormState>` (exported from `src/lib/actions/allowlist.ts`) and the `AddAllowlistForm` component (exported from `src/components/AddAllowlistForm.tsx`) — rendered by `/settings`.

- [ ] **Step 1: Write the failing tests**

Extend `tests/actions-allowlist.test.ts`. Update the import line:

```ts
const { listAllowlist, addAllowlistEntry, deactivateAllowlistEntry, addAllowlistEntryAction } = await import(
  '@/lib/actions/allowlist'
)
```

Add a small local helper and a new `describe` block at the end of the file:

```ts
function allowlistFormData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('addAllowlistEntryAction', () => {
  it('returns { ok: true } and upserts the entry for valid input', async () => {
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'New@Example.com', role: 'VOLUNTEER' })
    )

    expect(result).toEqual({ ok: true })
    expect(allowlistUpsert).toHaveBeenCalledWith({
      where: { email: 'new@example.com' },
      update: { role: 'VOLUNTEER', isActive: true },
      create: { email: 'new@example.com', role: 'VOLUNTEER', isActive: true },
    })
  })

  it('returns a friendly inline message instead of throwing for a malformed email', async () => {
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'not-an-email', role: 'ADMIN' })
    )

    expect(result).toEqual({ ok: false, message: "Email address doesn't look like a valid email address." })
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('returns a friendly inline message when the session is no longer an admin', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: 'new@example.com', role: 'VOLUNTEER' })
    )

    expect(result).toEqual({ ok: false, message: 'You are not authorized to do that.' })
    expect(allowlistUpsert).not.toHaveBeenCalled()
  })

  it('re-adding an existing email is a normal update, not an error', async () => {
    // addAllowlistEntry upserts on the unique email column, so there is no
    // duplicate-email failure mode for this action to catch — see the
    // plan's "Conflicts found" section.
    requireAdmin.mockResolvedValue(admin)

    const result = await addAllowlistEntryAction(
      { ok: true },
      allowlistFormData({ email: admin.email, role: 'ADMIN' })
    )

    expect(result).toEqual({ ok: true })
    expect(allowlistUpsert).toHaveBeenCalledWith({
      where: { email: admin.email },
      update: { role: 'ADMIN', isActive: true },
      create: { email: admin.email, role: 'ADMIN', isActive: true },
    })
  })

  it('rethrows an unexpected error so the app error boundary still catches it', async () => {
    requireAdmin.mockResolvedValue(admin)
    allowlistUpsert.mockRejectedValue(new Error('connection reset'))

    await expect(
      addAllowlistEntryAction({ ok: true }, allowlistFormData({ email: 'new@example.com', role: 'VOLUNTEER' }))
    ).rejects.toThrow('connection reset')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- actions-allowlist
```

Expected: FAIL — `addAllowlistEntryAction` is not exported from `@/lib/actions/allowlist`.

- [ ] **Step 3: Implement `addAllowlistEntryAction`**

In `src/lib/actions/allowlist.ts`, add these imports at the top of the file, alongside the existing ones:

```ts
import { ZodError } from 'zod'
import { AuthzError } from '@/lib/authz'
import { friendlyValidationMessage } from '@/lib/validation'
```

(the existing `import { requireAdmin } from '@/lib/authz'` line can be merged: `import { requireAdmin, AuthzError } from '@/lib/authz'`)

Add at the end of the file:

```ts
export type AllowlistFormState = { ok: boolean; message?: string }

/**
 * useActionState-compatible wrapper around addAllowlistEntry() for the
 * settings page's "Who can sign in" form. Catches invalid input and a
 * stale/revoked admin session as an inline { ok: false, message } result.
 *
 * addAllowlistEntry() upserts on the unique email column, so re-adding an
 * existing address is a normal update (e.g. changing that person's role),
 * not a Prisma unique-constraint error — there is deliberately no P2002
 * branch here. addAllowlistEntry() itself keeps its existing throwing
 * contract unchanged — other callers and its own tests above depend on it.
 */
export async function addAllowlistEntryAction(
  _prevState: AllowlistFormState,
  formData: FormData
): Promise<AllowlistFormState> {
  try {
    await addAllowlistEntry({ email: formData.get('email'), role: formData.get('role') })
  } catch (error) {
    if (error instanceof AuthzError) {
      return { ok: false, message: 'You are not authorized to do that.' }
    }
    if (error instanceof ZodError) {
      return { ok: false, message: friendlyValidationMessage(error) }
    }
    throw error
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- actions-allowlist
```

Expected: PASS, all tests in the file including the 5 new ones.

- [ ] **Step 5: Create `AddAllowlistForm`**

Create `src/components/AddAllowlistForm.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef } from 'react'
import { addAllowlistEntryAction, type AllowlistFormState } from '@/lib/actions/allowlist'

const initialState: AllowlistFormState = { ok: true }

export function AddAllowlistForm() {
  const [state, formAction, pending] = useActionState(addAllowlistEntryAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
    >
      <input name="email" type="email" placeholder="person@example.com" required style={{ padding: 'var(--space-3)' }} />
      <select name="role" required style={{ padding: 'var(--space-3)' }}>
        <option value="VOLUNTEER">Volunteer</option>
        <option value="ADMIN">Admin</option>
      </select>
      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Authorizing…' : 'Authorize'}</button>
    </form>
  )
}
```

- [ ] **Step 6: Wire `AddAllowlistForm` into the settings page**

In `src/app/settings/page.tsx`, add the import:

```ts
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
```

Replace the "Who can sign in" `<form>` — from:

```tsx
        <form
          action={async (formData: FormData) => {
            'use server'
            await addAllowlistEntry({ email: formData.get('email'), role: formData.get('role') })
          }}
          style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
        >
          <input name="email" type="email" placeholder="person@example.com" required style={{ padding: 'var(--space-3)' }} />
          <select name="role" required style={{ padding: 'var(--space-3)' }}>
            <option value="VOLUNTEER">Volunteer</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button type="submit">Authorize</button>
        </form>
```

to:

```tsx
        <AddAllowlistForm />
```

Update the existing `import { addAllowlistEntry, deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'` line — `addAllowlistEntry`'s direct call site moves into `addAllowlistEntryAction` inside `allowlist.ts`, so the settings page no longer calls it directly:

```ts
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
```

- [ ] **Step 7: Run a type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all passing, including the 5 new tests from Step 1.

- [ ] **Step 9: Commit**

```bash
git add src/lib/actions/allowlist.ts src/components/AddAllowlistForm.tsx src/app/settings/page.tsx tests/actions-allowlist.test.ts
git commit -m "feat: render add-allowlist form errors inline instead of crashing"
```

---

### Task 6: Full-suite verification and manual sign-off

**Files:** none (verification only — no commit at the end of this task unless a check below turns up a fix that needs one).

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all specs passing, including every test added in Tasks 1, 3, 4, and 5.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev`).

**Error boundaries (item 1):**

1. Sign in as a VOLUNTEER-role account. Navigate directly to `/settings`. Confirm you land on the existing `/denied` page ("Access denied" / "That Google account is not authorized...") — **not** Next's default error overlay/500 page.
2. As the same volunteer, navigate directly to `/report/<eventId>/manage` for any event. Confirm the same `/denied` redirect, not a crash.
3. Sign in as an ADMIN. Confirm `/settings` and `/report/<eventId>/manage` both load normally — the redirect only fires for `AuthzError`, never for a legitimate admin.
4. Temporarily force an unexpected error (e.g. comment out the `DATABASE_URL` env var, or throw inside `getManageRows` for a moment) and confirm `/report/<eventId>/manage` shows the new "Something went wrong" card with a working "Try again" button — not the raw Next dev overlay's stack trace treated as the *shipped* UI. (The dev overlay itself is expected in `next dev`; the point is that `error.tsx`'s fallback is what actually renders underneath/after dismissing it, and is what production serves.) Revert the temporary change afterward.

**Inline form errors (item 2):**

5. On `/settings` as an admin, submit "Add a category" with the Name field blank. Confirm an inline message ("Name is required.") appears next to the form with the `⚠` icon — the page does not crash or navigate away, and the rest of the settings page (Categories list, allowlist) is still visible.
6. Submit "Add a category" with a name+type that already exists (e.g. re-submit a category you just added). Confirm the inline message "A category with that name and type already exists." appears, not a crash.
7. Submit "Add a category" with valid, new input. Confirm it succeeds, the new category appears in the list below, and the form fields clear.
8. On the "Who can sign in" form, submit a malformed email (e.g. `not-an-email`). Confirm the inline message "Email address doesn't look like a valid email address." appears, not a crash.
9. Submit an email that's already on the allowlist with a different role selected. Confirm it succeeds silently (the existing entry's role updates in the list below) — this is the intentional non-error upsert behavior documented in this plan's "Conflicts found" section, not a bug.
10. Confirm the Retire and Revoke buttons still work exactly as before (they were not touched by this plan).

If any step fails, fix the underlying issue, re-run Steps 1–3, and repeat the failed manual step before considering this plan complete.
