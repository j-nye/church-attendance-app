import Link from 'next/link'
import { SignOutButton } from '@/components/SignOutButton'

/**
 * The one header every signed-in page shares. Deliberately role-independent
 * (no data fetching, no session check) — the app name, the Help link, and
 * Sign out are identical for every allowlisted user, so this stays a plain
 * server component with nothing to test beyond "does it render."
 *
 * `helpAnchor` scopes the Help link to the page's own section of /help
 * (e.g. "counting" -> /help#counting) so someone confused mid-task lands on
 * the relevant help, not the top of a long page. Omit it for a plain /help
 * link — used on the dashboard (no single section fits) and on /help itself.
 *
 * `no-print`: this strip is navigation chrome, not report content — it must
 * not appear in the printed/PDF version of a report. See src/styles/print.css,
 * which already hides .no-print under @media print for the report page's
 * own buttons.
 */
export function AppHeader({ helpAnchor }: { helpAnchor?: string }) {
  const helpHref = helpAnchor ? `/help#${helpAnchor}` : '/help'

  return (
    <header
      className="no-print"
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)',
      }}
    >
      <Link href="/dashboard" style={{ fontWeight: 700, color: 'var(--color-text)', textDecoration: 'none' }}>
        Church Attendance
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Link href={helpHref} style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Help
        </Link>
        <SignOutButton />
      </div>
    </header>
  )
}
