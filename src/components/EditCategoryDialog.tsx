'use client'

import { useState } from 'react'
import type { CategoryType } from '@prisma/client'
import { updateCategory } from '@/lib/actions/categories'
import { MAP_REGIONS } from '@/lib/map-regions'
import { TYPE_LABELS } from '@/lib/category-labels'

/**
 * Edits type/countsTowardTotal/svgKey behind a required warning — separate
 * from ConfirmDialog because it needs real form fields (not just a
 * checkbox), but follows the same "required confirmation checkbox, not
 * window.confirm()" pattern.
 */
export function EditCategoryDialog({
  category,
  sanctuarySvgKeys,
  onClose,
  onSaved,
}: {
  category: { id: string; name: string; type: CategoryType; svgKey: string | null; countsTowardTotal: boolean }
  /** Every currently-taken Sanctuary map region, across all sections (not just this category's own). */
  sanctuarySvgKeys: { id: string; svgKey: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<CategoryType>(category.type)
  const [countsTowardTotal, setCountsTowardTotal] = useState(category.countsTowardTotal)
  const [svgKey, setSvgKey] = useState<string>(category.svgKey ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const takenByOthers = sanctuarySvgKeys.filter((s) => s.id !== category.id).map((s) => s.svgKey)

  async function save() {
    setStatus('saving')
    setError(null)
    const resolvedSvgKey = type === 'SECTION' ? svgKey || null : null
    try {
      await updateCategory({ id: category.id, type, countsTowardTotal, svgKey: resolvedSvgKey })
      onSaved()
      onClose()
    } catch {
      setStatus('error')
      setError('Could not save — please try again.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${category.name}`}
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(28rem, 100%)', display: 'grid', gap: 'var(--space-3)' }}>
        <h2 style={{ marginTop: 0 }}>Edit {category.name}</h2>

        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CategoryType)}
            style={{ padding: 'var(--space-3)' }}
          >
            {(Object.keys(TYPE_LABELS) as CategoryType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>

        {type === 'SECTION' && (
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            Map region
            <select value={svgKey} onChange={(e) => setSvgKey(e.target.value)} style={{ padding: 'var(--space-3)' }}>
              <option value="">Not on the map (shows in the list)</option>
              {MAP_REGIONS.map((region) => (
                <option key={region.key} value={region.key} disabled={takenByOthers.includes(region.key)}>
                  {region.label}
                  {takenByOthers.includes(region.key) ? ' (taken)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            type="checkbox"
            checked={countsTowardTotal}
            onChange={(e) => setCountsTowardTotal(e.target.checked)}
          />
          Counts toward Total Attendance
        </label>

        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
            padding: 'var(--space-3)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius)',
          }}
        >
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>This changes how every past report groups and totals this category.</span>
        </label>

        {status === 'error' && error && (
          <p role="alert" style={{ color: 'var(--color-danger)', margin: 0 }}>
            <span aria-hidden="true">⚠</span> {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={save}
            disabled={!acknowledged || status === 'saving'}
            style={{ flex: 2, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700 }}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
