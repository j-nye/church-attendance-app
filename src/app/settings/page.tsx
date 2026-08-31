import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { deactivateCategory } from '@/lib/actions/categories'
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { AddCategoryForm } from '@/components/AddCategoryForm'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'

export default async function SettingsPage() {
  // Page-level gate. The actions below each re-check independently — this
  // call is convenience, not the boundary. On AuthzError it redirects to
  // /denied instead of leaving Next's raw error screen as the only outcome.
  await requireAdminPage()

  const [categories, allowlist] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] }),
    listAllowlist(),
  ])

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

      <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0 }}>Add a category</h2>
        <AddCategoryForm />
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Map positions are fixed. A category not assigned to a map region still works — it
          appears in the list below the map on the entry screen.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0 }}>Categories</h2>
        {categories.map((category) => (
          <div key={category.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
            <span style={{ opacity: category.isActive ? 1 : 0.5 }}>
              {category.name} <small style={{ color: 'var(--color-text-muted)' }}>({category.type})</small>
            </span>
            {category.isActive && (
              <form action={async () => { 'use server'; await deactivateCategory(category.id) }}>
                <button type="submit">Retire</button>
              </form>
            )}
          </div>
        ))}
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Retiring hides a category from new counts but keeps its history in past summaries.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Who can sign in</h2>
        <AddAllowlistForm />

        {allowlist.map((entry) => (
          <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
            <span style={{ opacity: entry.isActive ? 1 : 0.5 }}>
              {entry.email} <small style={{ color: 'var(--color-text-muted)' }}>({entry.role})</small>
            </span>
            {entry.isActive && (
              <form action={async () => { 'use server'; await deactivateAllowlistEntry(entry.id) }}>
                <button type="submit">Revoke</button>
              </form>
            )}
          </div>
        ))}
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Revoking takes effect immediately — the next action that person attempts is refused.
        </p>
      </section>

      <section className="card" style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0 }}>Export attendance data</h2>
        <form action="/api/export" method="get" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            Start date
            <input type="date" name="start" required style={{ padding: 'var(--space-3)' }} />
          </label>
          <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
            End date
            <input type="date" name="end" required style={{ padding: 'var(--space-3)' }} />
          </label>
          <button type="submit">Download CSV</button>
        </form>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Downloads one row per category per service for every service in the range, including
          archived services.
        </p>
      </section>
    </main>
  )
}
