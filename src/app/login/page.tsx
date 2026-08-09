import { SignInButton } from '@/components/SignInButton'

export default function LoginPage() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '24rem' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 0 }}>Church Attendance</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Sign in with the Google account your church administrator authorized.
        </p>
        <SignInButton />
      </div>
    </main>
  )
}
