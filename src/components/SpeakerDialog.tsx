'use client'

import { useState } from 'react'
import { addSpeaker, removeSpeaker, listSpeakers, type Speaker } from '@/lib/actions/speakers'

type Status = 'idle' | 'saving' | 'error'

export function SpeakerDialog({
  eventId,
  speakers: initialSpeakers,
  onClose,
  onChange,
}: {
  eventId: string
  speakers: Speaker[]
  onClose: () => void
  /** Called with the full updated list after every successful add/remove. */
  onChange: (speakers: Speaker[]) => void
}) {
  const [speakers, setSpeakers] = useState(initialSpeakers)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setStatus('saving')
    try {
      await addSpeaker({ eventId, name: trimmed })
      // Refetch rather than optimistically append — the server is the only
      // source of the new row's real id (and a duplicate name is a
      // no-op with no new id at all).
      const fresh = await listSpeakers(eventId)
      setSpeakers(fresh)
      onChange(fresh)
      setName('')
      setStatus('idle')
    } catch {
      // Loud, not silent — matches CounterDialog's error handling for saves.
      setStatus('error')
    }
  }

  async function handleRemove(speaker: Speaker) {
    setRemovingId(speaker.id)
    setStatus('saving')
    try {
      await removeSpeaker({ eventId, speakerId: speaker.id })
      const next = speakers.filter((s) => s.id !== speaker.id)
      setSpeakers(next)
      onChange(next)
      setStatus('idle')
    } catch {
      setStatus('error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Speakers"
      style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 0.6)', padding: 'var(--space-4)', zIndex: 10,
      }}
    >
      <div className="card" style={{ width: 'min(24rem, 100%)' }}>
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>Speakers</h2>

        {speakers.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>No speakers recorded yet</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {speakers.map((speaker) => (
              <li
                key={speaker.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span>{speaker.name}</span>
                <button
                  onClick={() => handleRemove(speaker)}
                  disabled={status === 'saving'}
                  aria-label={`Remove ${speaker.name}`}
                >
                  {removingId === speaker.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Speaker name"
            aria-label="New speaker name"
            style={{ flex: 1 }}
            maxLength={80}
          />
          <button onClick={handleAdd} disabled={status === 'saving' || !name.trim()}>
            Add
          </button>
        </div>

        {status === 'error' && (
          <p
            role="alert"
            style={{
              color: 'var(--color-danger)', display: 'flex', alignItems: 'center',
              gap: 'var(--space-2)', marginTop: 'var(--space-3)',
            }}
          >
            <span aria-hidden="true">⚠</span>
            Could not save — check your signal and try again.
          </p>
        )}

        <button onClick={onClose} style={{ width: '100%', marginTop: 'var(--space-4)' }}>
          Close
        </button>
      </div>
    </div>
  )
}
