'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { CategoryType } from '@prisma/client'
import { createCategoryAction, type CategoryFormState } from '@/lib/actions/categories'
import { MAP_REGIONS } from '@/lib/map-regions'

const initialState: CategoryFormState = { ok: true }

/**
 * type is fixed per section (no dropdown) — sent to createCategoryAction as
 * a hidden input, so the FormData shape (and createCategoryAction's parsing
 * of it) is unchanged from before this component took a `type` prop.
 */
export function AddCategoryForm({
  type,
  showSvgKey,
  showCountsToggle,
  takenSvgKeys,
}: {
  type: CategoryType
  showSvgKey: boolean
  showCountsToggle: boolean
  takenSvgKeys: string[]
}) {
  const [state, formAction, pending] = useActionState(createCategoryAction, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input type="hidden" name="type" value={type} />
      <input name="name" placeholder="Name" required maxLength={60} style={{ padding: 'var(--space-3)' }} />

      {showSvgKey && (
        <select name="svgKey" style={{ padding: 'var(--space-3)' }}>
          <option value="">Not on the map (shows in the list)</option>
          {MAP_REGIONS.map((region) => (
            <option key={region.key} value={region.key} disabled={takenSvgKeys.includes(region.key)}>
              {region.label}
              {takenSvgKeys.includes(region.key) ? ' (taken)' : ''}
            </option>
          ))}
        </select>
      )}

      {showCountsToggle ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="checkbox" name="countsTowardTotal" defaultChecked />
          Counts toward Total Attendance
        </label>
      ) : (
        // Every section except Ministry Metrics counts toward the total by
        // default, with no visible toggle. A hidden input (rather than
        // simply omitting the field) keeps createCategoryAction's
        // `formData.get('countsTowardTotal') === 'on'` check working
        // exactly as it does when the checkbox above is checked.
        <input type="hidden" name="countsTowardTotal" value="on" />
      )}

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
