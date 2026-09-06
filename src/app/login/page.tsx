import Link from 'next/link'
import { SignInButton } from '@/components/SignInButton'

export default function LoginPage() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', maxWidth: '32rem', textAlign: 'center' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Church Attendance</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Church Attendance is an internal tool Manna Church uses to record and report Sunday
            attendance — headcounts by section, classroom, growth track, and serve team — across
            its services. Volunteers use it to enter counts after each service; administrators use
            it to review reports and manage categories and access.
          </p>
          <p style={{ color: 'var(--color-text-muted)' }}>
            We use Google Sign-In only to verify your identity: your Google account&rsquo;s email
            address is checked against an internal list of authorized volunteers and staff, and
            nothing else about your Google account is used. If your email isn&rsquo;t on that list,
            signing in won&rsquo;t grant access.
          </p>
        </div>
        <div className="card" style={{ textAlign: 'center', maxWidth: '24rem', width: '100%' }}>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
            Sign in with the Google account your church administrator authorized.
          </p>
          <SignInButton />
        </div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
        </p>
      </div>
    </main>
  )
}
