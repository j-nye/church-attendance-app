'use client'

export function CategoryCard({
  name,
  count,
  onSelect,
}: {
  name: string
  count: number | undefined
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-label={`${name}, count ${count ?? 0}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-1)', padding: 'var(--space-3)', textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)' }}>{name}</span>
      <span style={{ fontWeight: 800, fontSize: 'var(--text-xl)', color: 'var(--color-accent)' }}>
        {count ?? '—'}
      </span>
    </button>
  )
}
