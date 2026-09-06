import { requireUserPage } from '@/lib/authz'
import { AppHeader } from '@/components/AppHeader'

export default async function HelpPage() {
  // Content is identical for every allowlisted user — gated the same as
  // every other signed-in page, not because anything here is secret.
  await requireUserPage()

  return (
    <>
      <AppHeader />
      <main style={{ padding: 'var(--space-4)', maxWidth: '40rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Help</h1>

        <section id="counting" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Counting attendance</h2>
          <p>
            On the dashboard, tap <strong>Start counting today&apos;s service</strong>. If no one has
            set up today&apos;s service yet, this creates it automatically — you don&apos;t need to
            wait for an admin.
          </p>
          <p>
            Tap a section on the sanctuary map, or a classroom, growth track, serve team, or
            ministry metric, to open its counter. Use the +1 / −1 buttons, or the +5 / +10 / +25
            shortcuts for a fast count. The count never goes below 0.
          </p>
          <p>
            Tap <strong>Save</strong> when you&apos;re done. It&apos;s safe to save more than
            once — tapping Save twice, or two volunteers both counting the same room, never
            doubles the number. Each save simply overwrites with the latest count.
          </p>
          <p>
            If your phone loses signal or the tab closes before you save, your unsaved tally
            stays on that device and comes back the next time you open that counter — nothing is
            lost.
          </p>
          <p>
            Ministry Metrics (things like Salvations) use the same counter as everything else,
            but they&apos;re tracked separately — see <a href="#reports">Reports</a> for what
            does and doesn&apos;t count toward the Total.
          </p>
        </section>

        <section id="speakers" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Recording who&apos;s speaking</h2>
          <p>
            On the entry screen&apos;s sanctuary map, tap the stage to open the Speakers list for
            that service.
          </p>
          <p>
            Type a name and tap <strong>Add</strong>. Adding the same name twice is simply
            ignored, not added as a duplicate. Tap <strong>Remove</strong> next to a name to take
            them off the list.
          </p>
          <p>Speakers recorded for a service also appear at the top of that service&apos;s report.</p>
        </section>

        <section id="reports" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Reading the summary and printing</h2>
          <p>
            Tap <strong>Summary</strong> on a service, from the dashboard or the entry screen, to
            see its report. Counts are grouped by Sanctuary, Classrooms, Growth Track, Serve
            Teams, and Ministry Metrics.
          </p>
          <p>
            The Total adds Sanctuary + Classrooms + Growth Track + Serve Teams. Ministry Metrics
            (like Salvations) are shown on the report but are never added into the Total — they
            measure something other than attendance.
          </p>
          <p>
            Tap <strong>Print summary</strong> for a clean, paper-friendly copy — buttons, links,
            and this header are hidden automatically when you print.
          </p>
          <p>
            From the dashboard, tapping a service&apos;s row (not the Enter counts / Summary
            links) expands the same five totals right there, without leaving the dashboard.
          </p>
        </section>

        <section id="manage" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Manage Records (Admins)</h2>
          <p>
            From a service&apos;s report page, admins see a <strong>Manage Records</strong> link.
            It lists every category relevant to that service — including ones with no count yet,
            and, rarely, a retired category that still has an old count on it.
          </p>
          <p>
            <strong>Edit</strong> reopens the same +/− counter used on the entry screen, saved the
            same safe, repeat-proof way.
          </p>
          <p>
            <strong>Delete</strong> permanently removes that category&apos;s count for this
            service — it doesn&apos;t reset it to 0, it removes the record entirely, so the
            category goes back to showing as unrecorded. You&apos;ll be asked to confirm first,
            and it can&apos;t be undone from the app once you do.
          </p>
        </section>

        <section id="categories" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Categories (Admins)</h2>
          <p>
            In Settings, categories are grouped into five sections — Sanctuary, Classrooms,
            Growth Track, Serve Team, and Ministry Metrics. Each section has its own <strong>Add
            category</strong> form at the bottom, so a new category&apos;s type is set by which
            section you add it to, not by picking from a dropdown.
          </p>
          <p>
            The <strong>↑</strong> / <strong>↓</strong> arrows reorder categories within a
            section — that&apos;s the order volunteers see on the entry screen.{' '}
            <strong>Rename</strong> just changes the display name; since past records are tied to
            the category itself, not its name, renaming doesn&apos;t touch history.
          </p>
          <p>
            <strong>Edit</strong> changes a category&apos;s type, its position on the sanctuary
            map, or whether it counts toward the Total. Because that changes how every past
            report groups and totals this category — not just future ones — you have to check a
            warning box before Save turns on.
          </p>
          <p>
            <strong>Hide</strong> moves a category into that section&apos;s Hidden list, off the
            entry screen, without losing anything already recorded for it — past reports and CSV
            exports are unaffected. <strong>Show</strong>, in the Hidden list, brings it back.
          </p>
          <p>
            <strong>Delete</strong> only shows up for a category that has never had a count
            recorded. Once a category has history, Hide is the way to remove it from the entry
            screen — Delete stays unavailable so a past report can&apos;t lose the category it
            points to. Deleting is permanent and asks for confirmation first.
          </p>
        </section>

        <section id="services" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Services (Admins)</h2>
          <p>
            In Settings, the <strong>Services</strong> section creates a new service: give it a
            name and a date. The date defaults to the upcoming Sunday, but you can pick any
            date — useful for a midweek service or a one-off event.
          </p>
          <p>Below the form is a list of recent services, most recent first, including archived ones.</p>
          <p>
            <strong>Archive</strong> stops a service from accepting new counts or edits — it
            drops off the volunteer dashboard — but its history stays exactly as it was: reports
            and CSV exports for that service keep working the same as before. You&apos;ll be
            asked to confirm before it takes effect.
          </p>
          <p>
            <strong>Unarchive</strong> reverses a mistaken archive, putting the service back on
            the dashboard so counting can continue.
          </p>
        </section>

        <section id="access" className="card" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ marginTop: 0 }}>Who can sign in (Admins)</h2>
          <p>
            In Settings under <strong>Who can sign in</strong>, add the Google email address you
            want to authorize and choose a role — Volunteer or Admin.
          </p>
          <p>
            Only addresses on this list can sign in at all. An email that isn&apos;t listed lands
            on the &quot;Access denied&quot; page.
          </p>
          <p>
            <strong>Revoke</strong> takes effect immediately — the very next action that person
            tries (not just their next sign-in) is refused, because every save, report, and
            setting change re-checks this list on the server. There&apos;s no waiting for a login
            session to expire.
          </p>
          <p>
            Admins see everything a Volunteer sees, plus Settings, Manage Records, and CSV
            export. Volunteers can count attendance and view reports.
          </p>
        </section>

        <section id="export" className="card">
          <h2 style={{ marginTop: 0 }}>CSV downloads (Admins)</h2>
          <p>There are two ways to download attendance data as a CSV:</p>
          <p>
            <strong>Download CSV</strong> on a single service&apos;s report page downloads just
            that service.
          </p>
          <p>
            <strong>Export attendance data</strong> in Settings downloads every service between a
            start and end date you choose, all in one file — including archived services, since
            archiving hides a service from new counting but doesn&apos;t erase its history.
          </p>
          <p>
            Each row in the file is one category&apos;s count for one service: the service date
            and name, the category&apos;s type and name, the count, whether it counts toward the
            Total, and who recorded it.
          </p>
          <p>
            If a service has recorded speakers, they appear as extra rows after its counts —
            marked <strong>SPEAKER</strong> in the type column, with the person&apos;s name in
            the Category column and an empty count.
          </p>
        </section>
      </main>
    </>
  )
}
