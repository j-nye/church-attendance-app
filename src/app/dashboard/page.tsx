import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, listTodayEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate, formatServiceTime } from '@/lib/dates'
import { AppHeader } from '@/components/AppHeader'
import { ServiceCard } from '@/components/ServiceCard'

const startButtonStyle = {
  width: '100%',
  padding: 'var(--space-4)',
  fontSize: 'var(--text-lg)',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-contrast)',
  fontWeight: 700,
} as const

export default async function DashboardPage() {
  const user = await requireUserPage()
  const [events, todayEvents] = await Promise.all([listEvents(), listTodayEvents()])

  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
          {user.role === 'ADMIN' && <Link href="/settings">Settings</Link>}
        </header>

        {todayEvents.length <= 1 ? (
          // 0 services: getOrCreateTodayEvent creates one on the fly. Exactly
          // 1: it's unambiguous, so the button can still start it directly —
          // labelled with its time so the volunteer confirms it's the right
          // one before tapping.
          <form
            action={async () => {
              'use server'
              const { redirect } = await import('next/navigation')
              const event = await getOrCreateTodayEvent()
              redirect(`/entry/${event.id}`)
            }}
          >
            <button type="submit" style={startButtonStyle}>
              {todayEvents.length === 1
                ? `Start counting — ${formatServiceTime(todayEvents[0].startTime)}`
                : "Start counting today's service"}
            </button>
          </form>
        ) : (
          // 2+ services today: never guess which one. One button per
          // service, each posting that specific eventId. No default
          // selection and no auto-redirect — see getOrCreateTodayEvent's
          // doc comment for why this function refuses to pick for you.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              Multiple services today — choose one:
            </p>
            {todayEvents.map((event) => (
              <form
                key={event.id}
                action={async () => {
                  'use server'
                  const { redirect } = await import('next/navigation')
                  redirect(`/entry/${event.id}`)
                }}
              >
                <button type="submit" style={startButtonStyle}>
                  Start counting — {formatServiceTime(event.startTime)} ({event.name})
                </button>
              </form>
            ))}
          </div>
        )}

        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-8)' }}>
          {events.map((event) => (
            <ServiceCard
              key={event.id}
              id={event.id}
              name={event.name}
              serviceDate={formatServiceDate(event.serviceDate)}
              serviceTime={formatServiceTime(event.startTime)}
            />
          ))}
        </ul>
      </main>
    </>
  )
}
