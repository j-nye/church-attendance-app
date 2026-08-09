'use client'

import { useState } from 'react'
import { SanctuaryMap } from '@/components/SanctuaryMap'
import { CounterDialog } from '@/components/CounterDialog'
import { CategoryRow } from '@/components/CategoryRow'

type Category = { id: string; name: string; type: string; svgKey: string | null }

export function EntryClient({
  eventId,
  categories,
  initialCounts,
}: {
  eventId: string
  categories: Category[]
  initialCounts: Record<string, number>
}) {
  const [counts, setCounts] = useState(initialCounts)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const placed = categories.filter((c): c is Category & { svgKey: string } => Boolean(c.svgKey))
  const unplaced = categories.filter((c) => !c.svgKey)
  const selected = categories.find((c) => c.id === selectedId)

  return (
    <>
      <SanctuaryMap categories={placed} counts={counts} onSelect={setSelectedId} />

      <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-8)' }}>Serve Teams &amp; Other</h2>
      {unplaced.map((category) => (
        <CategoryRow
          key={category.id}
          name={category.name}
          count={counts[category.id]}
          onSelect={() => setSelectedId(category.id)}
        />
      ))}

      {selected && (
        <CounterDialog
          eventId={eventId}
          categoryId={selected.id}
          categoryName={selected.name}
          initialCount={counts[selected.id] ?? 0}
          onClose={() => setSelectedId(null)}
          onSaved={(count) => setCounts((prev) => ({ ...prev, [selected.id]: count }))}
        />
      )}
    </>
  )
}
