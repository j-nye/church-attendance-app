'use client'

import { useState } from 'react'
import type { Role } from '@prisma/client'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
import {
  deactivateAllowlistEntry,
  updateAllowlistNameAction,
  type AllowlistFormState,
} from '@/lib/actions/allowlist'

export type AllowlistRowData = {
  id: string
  email: string
  role: Role
  isActive: boolean
  name: string | null
  adminOverrideName: string | null
  createdAt: Date
  updatedAt: Date
}

const initialState: AllowlistFormState = { ok: true }

/**
 * Inline display-name editor for one allowlist row. Follows the exact
 * busy/error pattern EditScheduleForm uses in ServicesSection.tsx
 * (setBusy/setError, a role="alert" paragraph) rather than inventing a new
 * one for this component. Calls updateAllowlistNameAction directly, not
 * useActionState — same reasoning as EditScheduleForm: the enclosing row
 * owns the open/closed state, and a direct call keeps success/failure
 * handling in one place.
 *
 * Defaults the input to the current adminOverrideName (never the Google-
 * synced `name`) — editing this field always writes an override, so it
 * should show the override that's already there, or empty if none.
 */
function EditNameForm({ entry, onDone }: { entry: AllowlistRowData; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    const result = await updateAllowlistNameAction(initialState, formData)
    if (!result.ok) {
      setError(result.message ?? 'Could not save — please try again.')
      setBusy(false)
      return
    }
    setBusy(false)
    onDone()
  }

  return (
    <form
      onSubmit={save}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', width: '100%', marginTop: 'var(--space-2)' }}
    >
      <input type="hidden" name="id" value={entry.id} />
      <input
        name="name"
        type="text"
        placeholder="Display name"
        defaultValue={entry.adminOverrideName ?? ''}
        maxLength={80}
        style={{ padding: 'var(--space-2)' }}
      />
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
      {error && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, width: '100%' }}
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * One allowlist row. `showRole` is only true inside the Revoked group, which
 * mixes both roles — the Admins/Volunteers groups already say the role in
 * their <summary>, so repeating it per row there would be redundant.
 *
 * The Revoke button and its underlying call are relocated, not rewritten:
 * deactivateAllowlistEntry is already a Server Action (an exported async
 * function from the 'use server' src/lib/actions/allowlist.ts), so it's
 * called directly from the form's action rather than through the
 * inline-'use server'-arrow-function wrapper the old page.tsx used — that
 * wrapper form only compiles inside a Server Component, and this component
 * has to be a Client Component to own the per-row edit-toggle state. The
 * server-side self-revoke and last-admin checks inside
 * deactivateAllowlistEntry are unchanged and are still the actual boundary.
 */
function AllowlistRow({ entry, showRole }: { entry: AllowlistRowData; showRole: boolean }) {
  const [editing, setEditing] = useState(false)
  const displayName = entry.adminOverrideName ?? entry.name

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', opacity: entry.isActive ? 1 : 0.5,
      }}
    >
      <span>
        {displayName ? (
          <>
            {displayName}{' '}
            <small style={{ color: 'var(--color-text-muted)' }}>
              {entry.email}
              {showRole ? ` · ${entry.role}` : ''}
            </small>
          </>
        ) : (
          <>
            {entry.email}
            {showRole && <small style={{ color: 'var(--color-text-muted)' }}> ({entry.role})</small>}
          </>
        )}
      </span>

      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={() => setEditing((prev) => !prev)}>{editing ? 'Cancel' : 'Edit'}</button>
        {entry.isActive && (
          <form action={() => deactivateAllowlistEntry(entry.id)}>
            <button type="submit">Revoke</button>
          </form>
        )}
      </span>

      {editing && <EditNameForm entry={entry} onDone={() => setEditing(false)} />}
    </div>
  )
}

/**
 * One access-level group. <details>/<summary> is deliberate — native
 * disclosure gives keyboard and screen-reader behavior for free, matching
 * this codebase's preference for plain semantic elements over custom
 * disclosure widgets.
 */
function AllowlistGroup({
  title,
  entries,
  showRole,
  defaultOpen,
}: {
  title: string
  entries: AllowlistRowData[]
  showRole: boolean
  defaultOpen: boolean
}) {
  return (
    <details open={defaultOpen} style={{ marginTop: 'var(--space-2)' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, padding: 'var(--space-2) 0' }}>
        {title} ({entries.length})
      </summary>
      {entries.map((entry) => (
        <AllowlistRow key={entry.id} entry={entry} showRole={showRole} />
      ))}
    </details>
  )
}

/**
 * The "Who can sign in" settings section, grouped by access level so an
 * admin isn't scrolling one long run of addresses. Admins and Volunteers
 * groups are active-only and open by default; Revoked mixes both roles
 * (hence showRole there) and starts collapsed — it's the group that only
 * ever grows, and the main reason the flat list got long in the first
 * place.
 */
export function AllowlistSection({ entries }: { entries: AllowlistRowData[] }) {
  const admins = entries.filter((entry) => entry.isActive && entry.role === 'ADMIN')
  const volunteers = entries.filter((entry) => entry.isActive && entry.role === 'VOLUNTEER')
  const revoked = entries.filter((entry) => !entry.isActive)

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Who can sign in</h2>
      <AddAllowlistForm />

      <AllowlistGroup title="Admins" entries={admins} showRole={false} defaultOpen={true} />
      <AllowlistGroup title="Volunteers" entries={volunteers} showRole={false} defaultOpen={true} />
      <AllowlistGroup title="Revoked" entries={revoked} showRole={true} defaultOpen={false} />

      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Revoking takes effect immediately — the next action that person attempts is refused.
      </p>
    </section>
  )
}
