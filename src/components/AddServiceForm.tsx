'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  addServiceAction,
  addNamedServiceAction,
  type AddServiceFormState,
  type ServiceCollision,
} from '@/lib/actions/events'
import { formatServiceDate, formatServiceTime, todayServiceDate } from '@/lib/dates'

const initialState: AddServiceFormState = { ok: true }

type Mode =
  | { kind: 'closed' }
  | { kind: 'schedule' }
  | { kind: 'collision'; serviceDate: string; startTime: string; existing: ServiceCollision }
  | { kind: 'naming'; serviceDate: string; startTime: string; existing: ServiceCollision }

const alertStyle = {
  color: 'var(--color-danger)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  margin: 0,
} as const

/**
 * Lets a signed-in volunteer (not just an admin) add an additional service —
 * for today or for any date within the server-enforced rolling window (see
 * addService's doc comment in src/lib/actions/events.ts for why the window
 * is what justifies requireUser() rather than requireAdmin() here).
 *
 * The component stays completely role-agnostic — it never receives or
 * checks a role; the dashboard resolves the window server-side
 * (serviceDateWindowFor) and passes only plain date strings. No role value
 * ever crosses into this client component.
 *
 * Follows EditScheduleForm's busy/error mechanics exactly (setBusy/setError,
 * role="alert" for real errors) rather than inventing a new pattern. The
 * collision step uses role="status" instead — it's a choice for the
 * volunteer to make, not a failure.
 */
export function AddServiceForm({
  defaultServiceDate,
  minServiceDate,
  maxServiceDate,
}: {
  defaultServiceDate: string
  minServiceDate: string
  maxServiceDate: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [pickedDate, setPickedDate] = useState(defaultServiceDate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    // Read serviceDate and startTime before the state transition unmounts
    // the inputs.
    const serviceDate = String(formData.get('serviceDate') ?? '')
    const startTime = String(formData.get('startTime') ?? '')
    const result = await addServiceAction(initialState, formData)
    setBusy(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not add that service — please try again.')
      return
    }
    if (result.collision) {
      setMode({ kind: 'collision', serviceDate, startTime, existing: result.collision })
      return
    }
    if (result.eventId) router.push(`/entry/${result.eventId}`)
  }

  async function submitName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const formData = new FormData(event.currentTarget)
    const result = await addNamedServiceAction(initialState, formData)
    setBusy(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not add that service — please try again.')
      return
    }
    if (result.eventId) router.push(`/entry/${result.eventId}`)
  }

  function reset() {
    setMode({ kind: 'closed' })
    setPickedDate(defaultServiceDate)
    setError(null)
    setBusy(false)
  }

  if (mode.kind === 'closed') {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <button type="button" onClick={() => setMode({ kind: 'schedule' })}>
          + Add a service
        </button>
      </div>
    )
  }

  if (mode.kind === 'schedule') {
    return (
      <form
        onSubmit={submitSchedule}
        // noValidate is deliberate: minServiceDate/maxServiceDate for a
        // VOLUNTEER are set to exactly the server-enforced window
        // (serviceDateWindowFor), so without this the browser's native
        // range-overflow validation would silently swallow an out-of-window
        // submission before our onSubmit ever ran — meaning the friendly,
        // more informative server message (nearbyServiceDateSchema's "ask an
        // admin to create it in Settings") would never reach the volunteer.
        // The server stays the actual authority either way (see
        // addService's doc comment); min/max here are a picker hint, not a
        // enforcement mechanism, exactly like the ADMIN typo guard.
        noValidate
        style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}
      >
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          What date and time does this service start?
        </p>
        <input
          name="serviceDate"
          type="date"
          required
          value={pickedDate}
          onChange={(e) => setPickedDate(e.target.value)}
          min={minServiceDate}
          max={maxServiceDate}
          style={{ padding: 'var(--space-3)' }}
        />
        {/* No defaultValue on time — this is by definition an additional
            service, so a time default is almost certainly wrong. */}
        <input name="startTime" type="time" required style={{ padding: 'var(--space-3)' }} />
        {pickedDate !== defaultServiceDate && (
          <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {`This will create a service for ${formatServiceDate(pickedDate)} — not today.`}
          </p>
        )}
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
    const isToday = existing.serviceDate === todayServiceDate()
    const dateLabel = formatServiceDate(existing.serviceDate)
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {existing.isArchived ? (
          <p role="status" style={{ margin: 0 }}>
            {isToday
              ? `There's already a service at ${time} today (${existing.name}), but it's archived and can't accept counts. If that's not what you meant, ask an admin to restore it.`
              : `There's already a service at ${time} on ${dateLabel} (${existing.name}), but it's archived and can't accept counts. If that's not what you meant, ask an admin to restore it.`}
          </p>
        ) : existing.isCountingDone ? (
          <p role="status" style={{ margin: 0 }}>
            {isToday
              ? `There's already a ${time} service today: ${existing.name} (already marked counted). Is this the same service, or a different one?`
              : `There's already a service at ${time} on ${dateLabel}: ${existing.name} (already marked counted). Is this the same service, or a different one?`}
          </p>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            {isToday
              ? `There's already a service at ${time} today: ${existing.name}. Is this the same service, or a different one?`
              : `There's already a service at ${time} on ${dateLabel}: ${existing.name}. Is this the same service, or a different one?`}
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
            onClick={() =>
              setMode({ kind: 'naming', serviceDate: mode.serviceDate, startTime: mode.startTime, existing })
            }
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
      <input type="hidden" name="serviceDate" value={mode.serviceDate} />
      <input type="hidden" name="startTime" value={mode.startTime} />
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Give this service a name to tell it apart from the one already at that date and time.
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
          onClick={() =>
            setMode({ kind: 'collision', serviceDate: mode.serviceDate, startTime: mode.startTime, existing: mode.existing })
          }
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
