import Link from 'next/link'

export function LegalPageLayout({
  title,
  effectiveDate,
  children,
}: {
  title: string
  effectiveDate: string
  children: React.ReactNode
}) {
  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      <p>
        <Link href="/login">&larr; Back to sign in</Link>
      </p>
      <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>{title}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>Effective {effectiveDate}</p>
      <div style={{ lineHeight: 1.7 }}>{children}</div>
    </main>
  )
}
