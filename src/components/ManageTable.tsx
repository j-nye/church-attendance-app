'use client'

import { useState } from 'react'
import { CounterDialog } from '@/components/CounterDialog'
import { deleteCount } from '@/lib/actions/attendance'

export type ManageTableRow = {
  categoryId: string
  categoryName: string
  categoryType: string
  count?: number
  recordedBy?: string
  /** ISO string — plain serializable data crossing the server/client boundary. */
  updatedAt?: string
}

export function ManageTable({ eventId, rows: initialRows }: { eventId: string; rows: ManageTableRow[] }) {
  const [rows, setRows] = useState(initialRows)
  const [editingId, setEditingId] = useState<string | null>(null)

  const editing = rows.find((row) => row.categoryId === editingId)

  async function handleDelete(row: ManageTableRow) {
    if (!window.confirm(`Delete the recorded count for ${row.categoryName}? This cannot be undone.`)) {
      return
    }
    try {
      await deleteCount({ eventId, categoryId: row.categoryId })
      setRows((prev) =>
        prev.map((r) =>
          r.categoryId === row.categoryId
            ? { ...r, count: undefined, recordedBy: undefined, updatedAt: undefined }
            : r
        )
      )
    } catch {
      // Loud, not silent — matches CounterDialog's error handling for saves.
      window.alert('Could not delete — please try again.')
    }
  }

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Category</th>
            <th style={{ textAlign: 'left' }}>Type</th>
            <th style={{ textAlign: 'right' }}>Count</th>
            <th style={{ textAlign: 'left' }}>Recorded by</th>
            <th style={{ textAlign: 'left' }}>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryId}>
              <td>{row.categoryName}</td>
              <td>{row.categoryType}</td>
              <td style={{ textAlign: 'right' }}>{row.count ?? '—'}</td>
              <td>{row.recordedBy ?? '—'}</td>
              <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
              <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button onClick={() => setEditingId(row.categoryId)}>Edit</button>
                {row.count !== undefined && (
                  <button onClick={() => handleDelete(row)}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <CounterDialog
          eventId={eventId}
          categoryId={editing.categoryId}
          categoryName={editing.categoryName}
          initialCount={editing.count ?? 0}
          onClose={() => setEditingId(null)}
          onSaved={(count) =>
            setRows((prev) =>
              prev.map((r) =>
                r.categoryId === editing.categoryId
                  ? { ...r, count, updatedAt: new Date().toISOString() }
                  : r
              )
            )
          }
        />
      )}
    </>
  )
}
