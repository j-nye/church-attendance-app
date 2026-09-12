'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  addTodayEventAction,
  addNamedTodayEventAction,
  type AddTodayEventFormState,
  type TodayEventCollision,
} from '@/lib/actions/events'
import { formatServiceTime } from '@/lib/dates'

const initialState: AddTodayEventFormState = { ok: true }

type Mode =
  | { kind: 'closed' }
  | { kind: 'time' }
  | { kind: 'collision'; startTime: string; existing: TodayEventCollision }
  | { kind: 'naming'; startTime: string; existing: TodayEventCollision }

const alertStyle = {
  color: 'var(--color-danger)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  margin: 0,
} as const

/**
 * Lets a signed-in volunteer (not just an admin) add an additional service
 * for today, once today already has at least one — the gap that only having
 * the admin-only Settings "Create a service" form left open. Only rendered
 * by the dashboard when `todayEvents.length > 0`; the zero-service case is
 * handled entirely by the existing getOrCreateTodayEvent form.
 *
 * Follows EditScheduleForm's busy/error mechanics exactly (setBusy/setError,
 * role="alert" for real errors) rather than inventing a new pattern. The
 * collision step uses role="status" instead — it's a choice for the
 * volunteer to make, not a failure.
 */
export function AddTodayServiceForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitTime(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    // Read startTime before the state transition unmounts the input.
    const startTime = String(formData.get('startTime') ?? '')
    const result = await addTodayEventAction(initialState, formData)
    setBusy(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not add that service — please try again.')
      return
    }
    if (result.collision) {
      setMode({ kind: 'collision', startTime, existing: result.collision })
      return
    }
    if (result.eventId) router.push(`/entry/${result.eventId}`)
  }

  async function submitName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    const result = await addNamedTodayEventAction(initialState, formData)
    setBusy(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not add that service — please try again.')
      return
    }
    if (result.eventId) router.push(`/entry/${result.eventId}`)
  }

  function reset() {
    setMode({ kind: 'closed' })
    setError(null)
    setBusy(false)
  }

  if (mode.kind === 'closed') {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <button type="button" onClick={() => setMode({ kind: 'time' })}>
          + Add another service for today
        </button>
      </div>
    )
  }

  if (mode.kind === 'time') {
    return (
      <form
        onSubmit={submitTime}
        style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}
      >
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          What time does this service start?
        </p>
        {/* No defaultValue — this is by definition a second service today, so
            09:30 is the one time it almost certainly isn't. */}
        <input name="startTime" type="time" required style={{ padding: 'var(--space-3)' }} />
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add service'}</button>
          <button type="button" onClick={reset} disabled={busy}>Cancel</button>
        </div>
        {error && (
          <p role="alert" style={alertStyle}>
            <span aria-hidden="true">⚠</span>
            {error}
          </p>
        )}
      </form>
    )
  }

  if (mode.kind === 'collision') {
    const { existing } = mode
    const time = formatServiceTime(existing.startTime)
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {existing.isArchived ? (
          <p role="status" style={{ margin: 0 }}>
            {`There's already a service at ${time} today (${existing.name}), but it's archived and can't accept counts. If that's not what you meant, ask an admin to restore it.`}
          </p>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            {`There's already a service at ${time} today: ${existing.name}. Is this the same service, or a different one?`}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {!existing.isArchived && (
            <button type="button" onClick={() => router.push(`/entry/${existing.id}`)}>
              {`Go to ${time} service`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode({ kind: 'naming', startTime: mode.startTime, existing })}
          >
            This is a different service
          </button>
          <button type="button" onClick={reset}>Cancel</button>
        </div>
        {error && (
          <p role="alert" style={alertStyle}>
            <span aria-hidden="true">⚠</span>
            {error}
          </p>
        )}
      </div>
    )
  }

  // mode.kind === 'naming'
  return (
    <form
      onSubmit={submitName}
      style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}
    >
      <input type="hidden" name="startTime" value={mode.startTime} />
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Give this service a name to tell it apart from the one already at that time.
      </p>
      <input
        name="name"
        placeholder="e.g. Spanish Service"
        required
        maxLength={80}
        style={{ padding: 'var(--space-3)' }}
      />
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        This name will appear on the dashboard, the report, and the CSV export.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add service'}</button>
        <button
          type="button"
          onClick={() => setMode({ kind: 'collision', startTime: mode.startTime, existing: mode.existing })}
          disabled={busy}
        >
          Back
        </button>
      </div>
      {error && (
        <p role="alert" style={alertStyle}>
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </form>
  )
}
