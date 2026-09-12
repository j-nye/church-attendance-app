'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  createEventAction,
  updateEventScheduleAction,
  archiveEvent,
  unarchiveEvent,
  type EventFormState,
} from '@/lib/actions/events'
import { formatServiceDate, formatServiceTime } from '@/lib/dates'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export type ServiceRowData = {
  id: string
  name: string
  serviceDate: string
  startTime: string
  isArchived: boolean
}

const initialState: EventFormState = { ok: true }

/** Matches the backfill default for pre-existing rows (see the Task 1.1
 * migration). This is purely this form's own `defaultValue` convenience —
 * getOrCreateTodayEvent has no server-side default of its own any more; the
 * dashboard's zero-service form supplies its own explicit startTime the same
 * way (see src/app/dashboard/page.tsx). */
const DEFAULT_START_TIME = '09:30'

function CreateServiceForm({ defaultServiceDate }: { defaultServiceDate: string }) {
  const [state, formAction, pending] = useActionState(createEventAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input name="name" placeholder="Service name" required maxLength={80} style={{ padding: 'var(--space-3)' }} />
      <input
        name="serviceDate"
        type="date"
        defaultValue={defaultServiceDate}
        required
        style={{ padding: 'var(--space-3)' }}
      />
      <input
        name="startTime"
        type="time"
        defaultValue={DEFAULT_START_TIME}
        required
        style={{ padding: 'var(--space-3)' }}
      />
      {!state.ok && state.message && (
        <p
          role="alert"
          style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}
        >
          <span aria-hidden="true">⚠</span>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create service'}</button>
    </form>
  )
}

/**
 * Inline date/time editor for a ServiceRow. Follows the exact busy/error
 * pattern the sibling `unarchive` control in this file already uses
 * (setBusy/setError, a role="alert" paragraph) rather than inventing a new
 * one — see ServiceRow.unarchive. Still calls updateEventScheduleAction
 * (not the raw updateEventSchedule) so the P2002 collision message comes
 * back as the same friendly sentence createEventAction already produces,
 * surfaced inline where the admin can act on it.
 */
function EditScheduleForm({ service, onDone }: { service: ServiceRowData; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    const result = await updateEventScheduleAction(initialState, formData)
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
      <input type="hidden" name="id" value={service.id} />
      <input name="serviceDate" type="date" defaultValue={service.serviceDate} required style={{ padding: 'var(--space-2)' }} />
      <input name="startTime" type="time" defaultValue={service.startTime} required style={{ padding: 'var(--space-2)' }} />
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

function ServiceRow({ service }: { service: ServiceRowData }) {
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unarchive() {
    setBusy(true)
    setError(null)
    try {
      await unarchiveEvent(service.id)
    } catch {
      setError('Could not restore — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', opacity: service.isArchived ? 0.6 : 1,
      }}
    >
      <span>
        {service.name}{' '}
        <small style={{ color: 'var(--color-text-muted)' }}>
          ({formatServiceDate(service.serviceDate)} · {formatServiceTime(service.startTime)}
          {service.isArchived ? ', archived' : ''})
        </small>
      </span>

      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {/* An archived service refuses edits server-side — the archive dialog
            already promises "stops accepting counts and edits", so offering a
            control that always fails would be worse than not offering it. */}
        {!service.isArchived && (
          <button onClick={() => setEditing((prev) => !prev)}>{editing ? 'Cancel' : 'Edit'}</button>
        )}
        {service.isArchived ? (
          <button onClick={unarchive} disabled={busy}>{busy ? 'Restoring…' : 'Unarchive'}</button>
        ) : (
          <button onClick={() => setConfirming(true)}>Archive</button>
        )}
      </span>

      {editing && !service.isArchived && (
        <EditScheduleForm service={service} onDone={() => setEditing(false)} />
      )}

      {error && <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>}

      {confirming && (
        <ConfirmDialog
          title={`Archive ${service.name}?`}
          warningText="An archived service stops accepting counts and edits."
          confirmLabel="Archive"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await archiveEvent(service.id)
            setConfirming(false)
          }}
        />
      )}
    </div>
  )
}

export function ServicesSection({
  services,
  defaultServiceDate,
}: {
  services: ServiceRowData[]
  defaultServiceDate: string
}) {
  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 style={{ marginTop: 0 }}>Services</h2>
      <CreateServiceForm defaultServiceDate={defaultServiceDate} />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {services.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
      </div>
    </section>
  )
}
