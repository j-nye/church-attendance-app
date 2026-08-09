export default function DeniedPage() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '26rem' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', marginTop: 0 }}>Access denied</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          That Google account is not authorized for this app. Ask a church administrator to add
          your email address, then try again.
        </p>
        <a href="/login">Back to sign in</a>
      </div>
    </main>
  )
}
