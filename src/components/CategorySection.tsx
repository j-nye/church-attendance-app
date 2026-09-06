'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { CategoryType } from '@prisma/client'
import { AddCategoryForm } from '@/components/AddCategoryForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EditCategoryDialog } from '@/components/EditCategoryDialog'
import {
  moveCategory,
  deactivateCategory,
  reactivateCategory,
  deleteCategory,
  renameCategoryAction,
  type CategoryFormState,
} from '@/lib/actions/categories'

export type CategoryRowData = {
  id: string
  name: string
  type: CategoryType
  svgKey: string | null
  sortOrder: number
  isActive: boolean
  countsTowardTotal: boolean
  hasRecords: boolean
}

const renameInitialState: CategoryFormState = { ok: true }

function RenameForm({ category, onDone }: { category: CategoryRowData; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(renameCategoryAction, renameInitialState)
  // useActionState's initial state is { ok: true } — indistinguishable from
  // a real successful save unless we track whether a submission actually
  // happened. Without this, the effect below would fire on mount (state.ok
  // is already true before any submit) and instantly close the form.
  const submittedRef = useRef(false)

  useEffect(() => {
    if (submittedRef.current && state.ok) onDone()
  }, [state, onDone])

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submittedRef.current = true
      }}
      style={{ display: 'flex', gap: 'var(--space-2)', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input type="hidden" name="id" value={category.id} />
      <input
        name="name"
        defaultValue={category.name}
        required
        maxLength={60}
        style={{ flex: 1, padding: 'var(--space-2)' }}
      />
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={onDone}>Cancel</button>
      {!state.ok && state.message && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{state.message}</p>
      )}
    </form>
  )
}

function CategoryRow({
  category,
  isFirst,
  isLast,
  sanctuarySvgKeys,
}: {
  category: CategoryRowData
  isFirst: boolean
  isLast: boolean
  sanctuarySvgKeys: { id: string; svgKey: string }[]
}) {
  const [mode, setMode] = useState<'view' | 'renaming' | 'editing' | 'deleting'>('view')
  const [busy, setBusy] = useState<'up' | 'down' | 'hide' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function move(direction: 'up' | 'down') {
    setBusy(direction)
    setError(null)
    try {
      await moveCategory({ id: category.id, direction })
    } catch {
      setError('Could not reorder — please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function hide() {
    setBusy('hide')
    setError(null)
    try {
      await deactivateCategory(category.id)
    } catch {
      setError('Could not hide — please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (mode === 'renaming') {
    return (
      <div style={{ padding: 'var(--space-2) 0' }}>
        <RenameForm category={category} onDone={() => setMode('view')} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', padding: 'var(--space-2) 0', gap: 'var(--space-2)',
      }}
    >
      <span>{category.name}</span>
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
        <button onClick={() => move('up')} disabled={isFirst || busy !== null} aria-label={`Move ${category.name} up`}>↑</button>
        <button onClick={() => move('down')} disabled={isLast || busy !== null} aria-label={`Move ${category.name} down`}>↓</button>
        <button onClick={() => setMode('renaming')}>Rename</button>
        <button onClick={() => setMode('editing')}>Edit</button>
        <button onClick={hide} disabled={busy !== null}>Hide</button>
        {!category.hasRecords && <button onClick={() => setMode('deleting')}>Delete</button>}
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>
      )}

      {mode === 'editing' && (
        <EditCategoryDialog
          category={category}
          sanctuarySvgKeys={sanctuarySvgKeys}
          onClose={() => setMode('view')}
          onSaved={() => setMode('view')}
        />
      )}

      {mode === 'deleting' && (
        <ConfirmDialog
          title={`Delete ${category.name}?`}
          warningText="This permanently removes the category. This cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setMode('view')}
          onConfirm={async () => {
            await deleteCategory(category.id)
            setMode('view')
          }}
        />
      )}
    </div>
  )
}

function HiddenCategoryRow({ category }: { category: CategoryRowData }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function show() {
    setBusy(true)
    setError(null)
    try {
      await reactivateCategory(category.id)
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
        alignItems: 'center', padding: 'var(--space-2) 0', opacity: 0.6,
      }}
    >
      <span>{category.name}</span>
      <button onClick={show} disabled={busy}>{busy ? 'Restoring…' : 'Show'}</button>
      {error && <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, width: '100%' }}>{error}</p>}
    </div>
  )
}

export function CategorySection({
  type,
  label,
  categories,
  sanctuarySvgKeys,
}: {
  type: CategoryType
  label: string
  categories: CategoryRowData[]
  /** Every currently-taken Sanctuary map region, across all sections. */
  sanctuarySvgKeys: { id: string; svgKey: string }[]
}) {
  const active = [...categories.filter((c) => c.isActive)].sort((a, b) => a.sortOrder - b.sortOrder)
  const hidden = categories.filter((c) => !c.isActive)

  return (
    <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 style={{ marginTop: 0 }}>{label}</h2>

      {active.map((category, index) => (
        <CategoryRow
          key={category.id}
          category={category}
          isFirst={index === 0}
          isLast={index === active.length - 1}
          sanctuarySvgKeys={sanctuarySvgKeys}
        />
      ))}

      {hidden.length > 0 && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary>Hidden ({hidden.length})</summary>
          {hidden.map((category) => (
            <HiddenCategoryRow key={category.id} category={category} />
          ))}
        </details>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <AddCategoryForm
          type={type}
          showSvgKey={type === 'SECTION'}
          showCountsToggle={type === 'SERVICE_METRIC'}
          takenSvgKeys={sanctuarySvgKeys.map((s) => s.svgKey)}
        />
      </div>
    </section>
  )
}
