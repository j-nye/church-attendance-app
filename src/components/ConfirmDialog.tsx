'use client'

import { useState } from 'react'

/**
 * The required-confirmation warning dialog used wherever an action needs
 * more friction than a plain button but isn't complex enough to need its
 * own form (Delete category, Archive service). NOT window.confirm() — a
 * checkbox must be explicitly checked before the destructive/impactful
 * button enables, per the settings redesign spec.
 */
export function ConfirmDialog({
  title,
  warningText,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string
  warningText: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setStatus('saving')
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not complete that action — please try again.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(24rem, 100%)', display: 'grid', gap: 'var(--space-3)' }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>

        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
            padding: 'var(--space-3)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius)',
          }}
        >
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>{warningText}</span>
        </label>

        {status === 'error' && error && (
          <p role="alert" style={{ color: 'var(--color-danger)', margin: 0 }}>
            <span aria-hidden="true">⚠</span> {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={confirm}
            disabled={!acknowledged || status === 'saving'}
            style={{
              flex: 2, fontWeight: 700,
              background: danger ? 'var(--color-danger)' : 'var(--color-accent)',
              color: 'var(--color-accent-contrast)',
            }}
          >
            {status === 'saving' ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
