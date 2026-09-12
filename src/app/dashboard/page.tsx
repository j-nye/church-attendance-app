import Link from 'next/link'
import { requireUserPage } from '@/lib/authz'
import { listEvents, listTodayEvents, getOrCreateTodayEvent } from '@/lib/actions/events'
import { formatServiceDate, formatServiceTime, todayServiceDate, serviceDateWindowFor } from '@/lib/dates'
import { AppHeader } from '@/components/AppHeader'
import { ServiceCard } from '@/components/ServiceCard'
import { AddServiceForm } from '@/components/AddServiceForm'

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
  const { min, max } = serviceDateWindowFor(user.role)
  const [events, todayEvents] = await Promise.all([listEvents(), listTodayEvents()])
  // listTodayEvents() is UNCHANGED — still every non-archived service today,
  // counted or not. Partitioning here (not in the query) keeps
  // getOrCreateTodayEvent's own "does today have a live service at all" check
  // and its P2002 race recovery completely unaffected by counting-done state.
  // See getOrCreateTodayEvent's doc comment for why filtering the query
  // itself would silently reopen the wrong-service-routing bug it was built
  // to fix.
  // With the addition of past-date service creation within the rolling window,
  // we now look for pending services across ALL active events, not just today's.
  // This ensures a volunteer sees a 'Start counting' button for a service they
  // created yesterday but haven't marked done yet.
  const pending = events.filter((event) => !event.isCountingDone)

  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
          {user.role === 'ADMIN' && <Link href="/settings" className="button" style={{ padding: '0 var(--space-4)' }}>Settings</Link>}
        </header>

        {todayEvents.length === 0 && (
          // 0 services for TODAY: getOrCreateTodayEvent creates one on the fly.
          <form
            action={async (formData: FormData) => {
              'use server'
              const { redirect } = await import('next/navigation')
              const event = await getOrCreateTodayEvent(formData.get('startTime'))
              redirect(`/entry/${event.id}`)
            }}
            style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: pending.length > 0 ? 'var(--space-6)' : 0 }}
          >
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              {"Set the start time for today's service:"}
            </p>
            <input
              name="startTime"
              type="time"
              defaultValue="09:30"
              required
              style={{ padding: 'var(--space-3)' }}
            />
            <button type="submit" style={startButtonStyle}>
              {"Start counting today's service"}
            </button>
          </form>
        )}

        {pending.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {pending.length > 1 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                Multiple services to count — choose one:
              </p>
            )}
            {pending.map((event) => (
              <form
                key={event.id}
                action={async () => {
                  'use server'
                  const { redirect } = await import('next/navigation')
                  redirect(`/entry/${event.id}`)
                }}
              >
                <button type="submit" style={startButtonStyle}>
                  {/* Show both date and time since it could be from a past day */}
                  Start counting — {formatServiceDate(event.serviceDate)} {formatServiceTime(event.startTime)}
                  {!event.name.startsWith('Service - ') && ` (${event.name})`}
                </button>
              </form>
            ))}
          </div>
        ) : todayEvents.length > 0 ? (
          <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            All recent services are counted.
          </p>
        ) : null}

        <AddServiceForm
          defaultServiceDate={todayServiceDate()}
          minServiceDate={min}
          maxServiceDate={max}
        />

        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-8)' }}>
          {events.map((event) => (
            <ServiceCard
              key={event.id}
              id={event.id}
              name={event.name}
              serviceDate={formatServiceDate(event.serviceDate)}
              serviceTime={formatServiceTime(event.startTime)}
              isCountingDone={event.isCountingDone}
              canToggleCounting={true}
            />
          ))}
        </ul>
      </main>
    </>
  )
}
