'use client'

import { useState } from 'react'
import { saveCount } from '@/lib/actions/attendance'

type Status = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Resolve the count a dialog should open with: a local draft (an unsaved
 * bump left behind by a refresh, a backgrounded tab, or a dead battery)
 * takes priority over the server's `initialCount`, because the draft is
 * strictly newer information — it only exists when a save never completed.
 * A successful save always clears the draft (see `save()` below), so a
 * leftover draft never outlives the count it represents.
 */
export function resolveInitialCount(rawDraft: string | null, initialCount: number): number {
  if (rawDraft === null || rawDraft.trim() === '') return initialCount
  const parsed = Number(rawDraft)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : initialCount
}

export function draftKeyFor(eventId: string, categoryId: string): string {
  return `draft:${eventId}:${categoryId}`
}

export function CounterDialog({
  eventId,
  categoryId,
  categoryName,
  initialCount,
  onClose,
  onSaved,
}: {
  eventId: string
  categoryId: string
  categoryName: string
  initialCount: number
  onClose: () => void
  onSaved: (count: number) => void
}) {
  const draftKey = draftKeyFor(eventId, categoryId)

  const [count, setCount] = useState(() =>
    resolveInitialCount(typeof window === 'undefined' ? null : window.localStorage.getItem(draftKey), initialCount)
  )
  const [status, setStatus] = useState<Status>('idle')

  function bump(delta: number) {
    const next = Math.max(0, count + delta)
    setCount(next)
    // Survive a refresh, a backgrounded tab, or a dead battery mid-count.
    window.localStorage.setItem(draftKey, String(next))
  }

  async function save() {
    setStatus('saving')
    try {
      await saveCount({ eventId, categoryId, count })
      window.localStorage.removeItem(draftKey)
      setStatus('saved')
      onSaved(count)
      onClose()
    } catch {
      // Loud, not silent — a lost count on Sunday morning is unrecoverable.
      setStatus('error')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Count for ${categoryName}`}
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(24rem, 100%)', textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>{categoryName}</h2>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)' }}>
          <button onClick={() => bump(-1)} aria-label="Decrease count" style={{ width: 64, height: 64, fontSize: 28 }}>−</button>
          <output style={{ fontSize: '3rem', fontWeight: 700, minWidth: '4rem' }} aria-live="polite">{count}</output>
          <button onClick={() => bump(1)} aria-label="Increase count" style={{ width: 64, height: 64, fontSize: 28 }}>+</button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
          {[5, 10, 25].map((step) => (
            <button key={step} onClick={() => bump(step)} style={{ padding: '0 var(--space-3)' }}>+{step}</button>
          ))}
        </div>

        {status === 'error' && (
          <p role="alert" style={{ color: 'var(--color-danger)' }}>
            Could not save — your count is still here. Check your signal and tap Save again.
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
          <button onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={save}
            disabled={status === 'saving'}
            style={{ flex: 2, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700 }}
          >
            {status === 'saving' ? 'Saving…' : status === 'error' ? 'Retry save' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
