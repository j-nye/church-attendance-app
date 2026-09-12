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
  const pending = todayEvents.filter((event) => !event.isCountingDone)
  // The mark-done/reopen toggle only makes sense for today's services — the
  // flag has no visible effect on any other day, so ServiceCard only renders
  // it when the card's event is one of today's.
  const todayEventIds = new Set(todayEvents.map((event) => event.id))

  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Services</h1>
          {user.role === 'ADMIN' && <Link href="/settings">Settings</Link>}
        </header>

        {todayEvents.length === 0 ? (
          // 0 services: getOrCreateTodayEvent creates one on the fly. There's
          // no more silent server-side default time — the volunteer sets it
          // here (defaulting to the common 09:30 case), and it's validated
          // through startTimeSchema exactly like every other startTime in
          // this app. See getOrCreateTodayEvent's doc comment.
          <form
            action={async (formData: FormData) => {
              'use server'
              const { redirect } = await import('next/navigation')
              const event = await getOrCreateTodayEvent(formData.get('startTime'))
              redirect(`/entry/${event.id}`)
            }}
            style={{ display: 'grid', gap: 'var(--space-3)' }}
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
        ) : pending.length === 0 ? (
          // Today has services, but every one of them has been marked done —
          // there's nothing left to offer as a "start counting" target.
          // Deliberately no button here: calling getOrCreateTodayEvent would
          // hit its own unfiltered ">1 today" throw once a second service
          // exists, or silently return the lone done service if only one
          // does — either way, wrong. A done service is still fully visible
          // and countable via its ServiceCard below.
          <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            All of today&rsquo;s services are counted.
          </p>
        ) : pending.length === 1 ? (
          // Exactly 1 pending: unambiguous, so the button starts it directly
          // by redirecting to its already-known id — NOT by calling
          // getOrCreateTodayEvent(), which would re-run its own unfiltered
          // "today's live services" query and throw if a done sibling is
          // also present today (2 rows found). Modeled on the 2+ branch's
          // per-service form below, not the legacy 1-service branch.
          <form
            action={async () => {
              'use server'
              const { redirect } = await import('next/navigation')
              redirect(`/entry/${pending[0].id}`)
            }}
          >
            <button type="submit" style={startButtonStyle}>
              {`Start counting — ${formatServiceTime(pending[0].startTime)}`}
            </button>
          </form>
        ) : (
          // 2+ pending services today: never guess which one. One button per
          // service, each posting that specific eventId. No default
          // selection and no auto-redirect — see getOrCreateTodayEvent's
          // doc comment for why this function refuses to pick for you.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              Multiple services today — choose one:
            </p>
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
                  Start counting — {formatServiceTime(event.startTime)} ({event.name})
                </button>
              </form>
            ))}
          </div>
        )}

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
              canToggleCounting={todayEventIds.has(event.id)}
            />
          ))}
        </ul>
      </main>
    </>
  )
}
