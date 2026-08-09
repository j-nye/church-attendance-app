'use client'

import { MAP_REGIONS, MAP_VIEWBOX } from '@/lib/map-regions'

type Placed = { id: string; name: string; svgKey: string }

export function SanctuaryMap({
  categories,
  counts,
  onSelect,
}: {
  categories: Placed[]
  counts: Record<string, number>
  onSelect: (categoryId: string) => void
}) {
  const byKey = new Map(categories.map((category) => [category.svgKey, category]))

  return (
    <svg viewBox={MAP_VIEWBOX} role="group" aria-label="Sanctuary map" style={{ width: '100%', height: 'auto' }}>
      {MAP_REGIONS.map((region) => {
        const category = byKey.get(region.key)
        const count = category ? counts[category.id] : undefined
        const label = category?.name ?? region.label
        const isTappable = Boolean(category)

        return (
          <g
            key={region.key}
            role={isTappable ? 'button' : undefined}
            tabIndex={isTappable ? 0 : undefined}
            aria-label={isTappable ? `${label}, count ${count ?? 0}` : undefined}
            onClick={isTappable ? () => onSelect(category!.id) : undefined}
            onKeyDown={
              isTappable
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(category!.id)
                    }
                  }
                : undefined
            }
            style={{ cursor: isTappable ? 'pointer' : 'default' }}
          >
            <rect
              x={region.x}
              y={region.y}
              width={region.width}
              height={region.height}
              rx={10}
              fill={isTappable ? 'var(--color-surface-raised)' : 'var(--color-surface)'}
              stroke={count !== undefined ? 'var(--color-accent)' : 'var(--color-border)'}
              strokeWidth={count !== undefined ? 3 : 1.5}
            />
            {/* Text nodes only — React escapes these. Never dangerouslySetInnerHTML. */}
            <text
              x={region.x + region.width / 2}
              y={region.y + region.height / 2 - 6}
              textAnchor="middle"
              fill="var(--color-text)"
              fontSize={14}
            >
              {label}
            </text>
            {isTappable && (
              <text
                x={region.x + region.width / 2}
                y={region.y + region.height / 2 + 20}
                textAnchor="middle"
                fill="var(--color-accent)"
                fontSize={22}
                fontWeight={700}
              >
                {count ?? '—'}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
