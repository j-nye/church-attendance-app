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
