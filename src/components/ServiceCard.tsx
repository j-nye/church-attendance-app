'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getEventSummary } from '@/lib/actions/attendance'
import { markCountingDone, reopenCounting } from '@/lib/actions/events'

/** Derived from getEventSummary's own return type, so this never drifts out
 * of sync with the server-side shape it's rendering. */
type Totals = Awaited<ReturnType<typeof getEventSummary>>['totals']

type FetchStatus = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * A dashboard service list item. The header is a toggle button that expands
 * a READ-ONLY at-a-glance view of the service's recorded totals — the same
 * five numbers as the report page's totals card. Totals are lazy-fetched on
 * first expand only and cached in state: collapsing and re-expanding never
 * refetches.
 *
 * The "Enter counts" and "Summary" links are siblings of the toggle button,
 * never nested inside it — a link inside a <button> is an accessibility
 * violation (nested interactive content) and both links must keep working
 * as their own tap targets.
 */
export function ServiceCard({
  id,
  name,
  serviceDate,
  serviceTime,
  isCountingDone,
  canToggleCounting,
}: {
  id: string
  name: string
  serviceDate: string
  serviceTime?: string
  isCountingDone: boolean
  /** Only today's services can toggle this — the flag has no visible effect
   * on any other day, so the dashboard only sets this true for cards whose
   * event is one of today's. */
  canToggleCounting: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<FetchStatus>('idle')
  const [totals, setTotals] = useState<Totals | null>(null)
  const [done, setDone] = useState(isCountingDone)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  // Same busy/error mechanics as ServiceRow.unarchive in ServicesSection.tsx
  // — direct call inside its own try/catch, no useActionState wrapper (this
  // is an idempotent, input-light boolean flip, same shape as archive).
  async function toggleCountingDone() {
    setToggleBusy(true)
    setToggleError(null)
    try {
      if (done) {
        await reopenCounting(id)
        setDone(false)
      } else {
        await markCountingDone(id)
        setDone(true)
      }
    } catch {
      setToggleError('Could not update — please try again.')
    } finally {
      setToggleBusy(false)
    }
  }

  async function loadSummary() {
    setStatus('loading')
    try {
      const { totals } = await getEventSummary(id)
      setTotals(totals)
      setStatus('loaded')
    } catch {
      // Loud, not silent — matches CounterDialog's error handling for saves.
      // getEventSummary throwing for a nonexistent event lands here too;
      // there's nothing more specific to say to the viewer in either case.
      setStatus('error')
    }
  }

  function toggle() {
    setExpanded((prev) => !prev)
    // Lazy-fetch on first expand only — status only ever leaves 'idle' here,
    // so a later collapse/re-expand cycle (which only flips `expanded`)
    // never re-triggers this fetch. A failed fetch is retried only via the
    // explicit "Try again" button below, which calls loadSummary() directly.
    if (status === 'idle') {
      loadSummary()
    }
  }

  return (
    <li className="card" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
          padding: 0, background: 'none', border: 'none', font: 'inherit', color: 'inherit',
          textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div>
          <strong>{name}</strong>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {serviceDate}
            {serviceTime ? ` · ${serviceTime}` : ''}
            {done && (
              // A badge, not dimming — a done service is fully live (counts,
              // edits, everything work), so darkening the whole card the way
              // an archived ServiceRow does would falsely suggest otherwise.
              <span
                style={{
                  marginLeft: 'var(--space-2)',
                  padding: '0 var(--space-2)',
                  borderRadius: '999px',
                  background: 'var(--color-surface-raised)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                Counted
              </span>
            )}
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)',
            color: 'var(--color-text-muted)',
          }}
        >
          ▾
        </div>
      </button>

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href={`/entry/${id}`} className="button" style={{ padding: '0 var(--space-4)' }}>Enter counts</Link>
        <Link href={`/report/${id}`} className="button" style={{ padding: '0 var(--space-4)' }}>Summary</Link>
        {canToggleCounting && (
          <button type="button" onClick={toggleCountingDone} disabled={toggleBusy}>
            {toggleBusy ? 'Updating…' : done ? 'Reopen counting' : 'Mark counting done'}
          </button>
        )}
      </div>

      {toggleError && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, marginTop: 'var(--space-2)' }}>
          {toggleError}
        </p>
      )}

      {expanded && (
        <div
          style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}
        >
          {status === 'loading' && <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading…</p>}

          {status === 'error' && (
            <div
              role="alert"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-danger)' }}
            >
              <span aria-hidden="true">⚠</span>
              <span>Could not load counts.</span>
              <button type="button" onClick={loadSummary}>
                Try again
              </button>
            </div>
          )}

          {status === 'loaded' && totals && (
            <table style={{ width: '100%' }}>
              <tbody>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Sanctuary</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.sanctuary}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Classrooms</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.classrooms}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Growth Track</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.growthTrack}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>Serve Teams</td>
                  <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{totals.serveTeams}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{totals.grand}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  )
}
