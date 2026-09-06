'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createEventAction, archiveEvent, unarchiveEvent, type EventFormState } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export type ServiceRowData = {
  id: string
  name: string
  serviceDate: string
  isArchived: boolean
}

const initialState: EventFormState = { ok: true }

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

function ServiceRow({ service }: { service: ServiceRowData }) {
  const [confirming, setConfirming] = useState(false)
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
          ({formatServiceDate(service.serviceDate)}{service.isArchived ? ', archived' : ''})
        </small>
      </span>

      {service.isArchived ? (
        <button onClick={unarchive} disabled={busy}>{busy ? 'Restoring…' : 'Unarchive'}</button>
      ) : (
        <button onClick={() => setConfirming(true)}>Archive</button>
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
