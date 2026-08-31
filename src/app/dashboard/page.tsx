import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate } from '@/lib/dates'
import { SignOutButton } from '@/components/SignOutButton'
import { ServiceCard } from '@/components/ServiceCard'

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
          <ServiceCard
            key={event.id}
            id={event.id}
            name={event.name}
            serviceDate={formatServiceDate(event.serviceDate)}
          />
        ))}
      </ul>
    </main>
  )
}
