import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { SignOutButton } from '@/components/SignOutButton'

export default async function DashboardPage() {
  const user = await requireUserPage()
  const events = await listEvents()

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          {user.role === 'ADMIN' && <Link href="/settings">Settings</Link>}
          <SignOutButton />
        </div>
      </header>

      <form
        action={async () => {
          'use server'
          const { redirect } = await import('next/navigation')
          const event = await getOrCreateTodayEvent()
          redirect(`/entry/${event.id}`)
        }}
      >
        <button
          type="submit"
          style={{
            width: '100%', padding: 'var(--space-4)', fontSize: 'var(--text-lg)',
            background: 'var(--color-accent)', color: 'var(--color-accent-contrast)', fontWeight: 700,
          }}
        >
          Start counting today&apos;s service
        </button>
      </form>

      <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-8)' }}>
        {events.map((event) => (
          <li key={event.id} className="card" style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-4)' }}>
            <strong>{event.name}</strong>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              {formatServiceDate(event.serviceDate)}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
              <Link href={`/entry/${event.id}`}>Enter counts</Link>
              <Link href={`/report/${event.id}`}>Summary</Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
