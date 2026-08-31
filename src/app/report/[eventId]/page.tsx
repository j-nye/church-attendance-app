import Link from 'next/link'
import { getEventSummary } from '@/lib/actions/attendance'
import { PrintButton } from '@/components/PrintButton'
import { formatServiceDate } from '@/lib/dates'
import { TYPE_LABELS } from '@/lib/category-labels'
import { requireUserPage } from '@/lib/authz'

export default async function ReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const [user, { event, rows, totals }] = await Promise.all([requireUserPage(), getEventSummary(eventId)])

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 0 }}>{event.name}</h1>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {user.role === 'ADMIN' && (
            <>
              <Link
                href={`/report/${eventId}/manage`}
                className="no-print"
                style={{
                  display: 'inline-flex', alignItems: 'center', padding: '0 var(--space-4)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                  color: 'var(--color-text)', textDecoration: 'none',
                }}
              >
                Manage Records
              </Link>
              <a
                href={`/api/export?eventId=${eventId}`}
                className="no-print"
                style={{
                  display: 'inline-flex', alignItems: 'center', padding: '0 var(--space-4)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
                  color: 'var(--color-text)', textDecoration: 'none',
                }}
              >
                Download CSV
              </a>
            </>
          )}
          <PrintButton />
        </div>
      </div>

      {(['SECTION', 'CLASSROOM', 'GROWTH_TRACK', 'SERVE_TEAM', 'SERVICE_METRIC'] as const).map((type) => {
        const group = rows.filter((row) => row.type === type)
        if (group.length === 0) return null
        return (
          <section key={type} className="card report-group" style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ marginTop: 0, fontSize: 'var(--text-lg)' }}>{TYPE_LABELS[type]}</h2>
            <table>
              <tbody>
                {group.map((row) => (
                  <tr key={row.categoryId}>
                    <td>{row.name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{row.count}</td>
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
            <tr style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              <td>Total</td><td style={{ textAlign: 'right' }}>{totals.grand}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  )
}
