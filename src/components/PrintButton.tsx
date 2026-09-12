'use client'

export function PrintButton() {
  return (
    <button className="no-print" onClick={() => window.print()} style={{ padding: '0 var(--space-4)', whiteSpace: 'nowrap' }}>
      Print summary
    </button>
  )
}
