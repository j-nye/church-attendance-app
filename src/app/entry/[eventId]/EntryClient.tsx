'use client'

import { useState } from 'react'
import { SanctuaryMap } from '@/components/SanctuaryMap'
import { CounterDialog } from '@/components/CounterDialog'
import { SpeakerDialog } from '@/components/SpeakerDialog'
import { CategoryRow } from '@/components/CategoryRow'
import { CategoryCard } from '@/components/CategoryCard'
import type { Speaker } from '@/lib/actions/speakers'

type Category = { id: string; name: string; type: string; svgKey: string | null }

const GROUP_ORDER = ['CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC'] as const

const GROUP_META: Record<(typeof GROUP_ORDER)[number], { heading: string; layout: 'grid' | 'list'; dashed?: boolean; subtitle?: string }> = {
  CLASSROOM: { heading: 'Classrooms', layout: 'grid' },
  GROWTH_TRACK: { heading: 'Growth Track', layout: 'grid' },
  SERVE_TEAM: { heading: 'SERVE Team', layout: 'list' },
  SERVICE_METRIC: {
    heading: 'Ministry Metrics',
    layout: 'list',
    dashed: true,
    subtitle: 'Not counted in attendance',
  },
}

export function EntryClient({
  eventId,
  categories,
  initialCounts,
  initialSpeakers,
}: {
  eventId: string
  categories: Category[]
  initialCounts: Record<string, number>
  initialSpeakers: Speaker[]
}) {
  const [counts, setCounts] = useState(initialCounts)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [speakers, setSpeakers] = useState(initialSpeakers)
  const [isSpeakerDialogOpen, setIsSpeakerDialogOpen] = useState(false)

  const sanctuaryOnMap = categories.filter(
    (c): c is Category & { svgKey: string } => c.type === 'SECTION' && Boolean(c.svgKey)
  )
  // Sanctuary categories with no map position — e.g. Out of Service Total —
  // render as list rows under the same "Sanctuary" heading as the map.
  const sanctuaryListItems = categories.filter((c) => c.type === 'SECTION' && !c.svgKey)

  const groups = GROUP_ORDER.map((type) => ({
    type,
    meta: GROUP_META[type],
    items: categories.filter((c) => c.type === type),
  })).filter((group) => group.items.length > 0)

  const selected = categories.find((c) => c.id === selectedId)

  return (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)' }}>Sanctuary</h2>
      <SanctuaryMap
        categories={sanctuaryOnMap}
        counts={counts}
        onSelect={setSelectedId}
        onSelectStage={() => setIsSpeakerDialogOpen(true)}
        speakerCount={speakers.length}
      />
      {sanctuaryListItems.map((category) => (
        <CategoryRow
          key={category.id}
          name={category.name}
          count={counts[category.id]}
          onSelect={() => setSelectedId(category.id)}
        />
      ))}

      {groups.map(({ type, meta, items }) => (
        <div key={type}>
          <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-8)' }}>
            {meta.heading}
            {meta.subtitle && (
              <span style={{ fontWeight: 400, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                {' '}({meta.subtitle})
              </span>
            )}
          </h2>
          {meta.layout === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              {items.map((category) => (
                <CategoryCard
                  key={category.id}
                  name={category.name}
                  count={counts[category.id]}
                  onSelect={() => setSelectedId(category.id)}
                />
              ))}
            </div>
          ) : (
            items.map((category) => (
              <CategoryRow
                key={category.id}
                name={category.name}
                count={counts[category.id]}
                onSelect={() => setSelectedId(category.id)}
                dashed={meta.dashed}
              />
            ))
          )}
        </div>
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

      {isSpeakerDialogOpen && (
        <SpeakerDialog
          eventId={eventId}
          speakers={speakers}
          onClose={() => setIsSpeakerDialogOpen(false)}
          onChange={setSpeakers}
        />
      )}
    </>
  )
}
