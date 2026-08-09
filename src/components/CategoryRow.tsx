'use client'

export function CategoryRow({
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
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        width: '100%', padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-2)',
      }}
    >
      <span>{name}</span>
      <span style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: 'var(--text-lg)' }}>
        {count ?? '—'}
      </span>
    </button>
  )
}
