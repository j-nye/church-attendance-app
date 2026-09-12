import Link from 'next/link'
import { getEventSummary } from '@/lib/actions/attendance'
import { listSpeakers } from '@/lib/actions/speakers'
import { PrintButton } from '@/components/PrintButton'
import { formatServiceDate, formatServiceTime } from '@/lib/dates'
import { TYPE_LABELS } from '@/lib/category-labels'
import { requireUserPage } from '@/lib/authz'
import { AppHeader } from '@/components/AppHeader'

export default async function ReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const [user, { event, rows, totals, recordedByNames }, speakers] = await Promise.all([
    requireUserPage(),
    getEventSummary(eventId),
    listSpeakers(eventId),
  ])

  return (
    <>
      <AppHeader helpAnchor="reports" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
            <h1 style={{ fontSize: 'var(--text-xl)', margin: 0, flex: '1 1 min-content' }}>{event.name}</h1>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {user.role === 'ADMIN' && (
                <>
                  <Link
                    href={`/report/${eventId}/manage`}
                    className="button no-print"
                    style={{ padding: '0 var(--space-4)', whiteSpace: 'nowrap' }}
                  >
                    Manage Records
                  </Link>
                  <a
                    href={`/api/export?eventId=${eventId}`}
                    className="button no-print"
                    style={{ padding: '0 var(--space-4)', whiteSpace: 'nowrap' }}
                  >
                    Download CSV
                  </a>
                </>
              )}
              <PrintButton />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: 'var(--space-2) var(--space-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
              background: 'var(--color-surface)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div style={{ fontWeight: 600 }}>Date</div>
            <div>
              {formatServiceDate(event.serviceDate)} · {formatServiceTime(event.startTime)}
            </div>

            <div style={{ fontWeight: 600 }}>Speakers</div>
            <div>{speakers.length > 0 ? speakers.map((speaker) => speaker.name).join(', ') : '—'}</div>

            <div style={{ fontWeight: 600 }}>Recorded by</div>
            <div>{recordedByNames.length > 0 ? recordedByNames.join(', ') : '—'}</div>
          </div>
        </div>

        {(['SECTION', 'CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC'] as const).map((type) => {
          const group = rows.filter((row) => row.type === type)
          if (group.length === 0) return null
          return (
            <section key={type} className="card report-group" style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{ marginTop: 0, fontSize: 'var(--text-lg)' }}>{TYPE_LABELS[type]}</h2>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th style={{ textAlign: 'right' }}>Count</th>
                    <th style={{ textAlign: 'right' }}>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((row) => (
                    <tr key={row.categoryId}>
                      <td>{row.name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{row.count}</td>
                      <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                        {row.recordedByName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}

        <section className="card report-group">
          <table>
            <tbody>
              <tr><td>Sanctuary</td><td style={{ textAlign: 'right' }}>{totals.sanctuary}</td></tr>
              <tr><td>Classrooms</td><td style={{ textAlign: 'right' }}>{totals.classrooms}</td></tr>
              <tr><td>Growth Track</td><td style={{ textAlign: 'right' }}>{totals.growthTrack}</td></tr>
              <tr><td>Serve Teams</td><td style={{ textAlign: 'right' }}>{totals.serveTeams}</td></tr>
              <tr><td>Stage (Speakers)</td><td style={{ textAlign: 'right' }}>{totals.speakers}</td></tr>
              <tr style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                <td>Total</td><td style={{ textAlign: 'right' }}>{totals.grand}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    </>
  )
}
