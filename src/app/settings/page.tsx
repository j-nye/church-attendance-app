import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { AddAllowlistForm } from '@/components/AddAllowlistForm'
import { AppHeader } from '@/components/AppHeader'
import { CategorySection, type CategoryRowData } from '@/components/CategorySection'
import { TYPE_LABELS } from '@/lib/category-labels'
import type { CategoryType } from '@prisma/client'

export default async function SettingsPage() {
  // Page-level gate. The actions below each re-check independently — this
  // call is convenience, not the boundary. On AuthzError it redirects to
  // /denied instead of leaving Next's raw error screen as the only outcome.
  await requireAdminPage()

  const [categoryRecords, allowlist] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { records: true } } },
    }),
    listAllowlist(),
  ])

  const categories: CategoryRowData[] = categoryRecords.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    svgKey: c.svgKey,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    countsTowardTotal: c.countsTowardTotal,
    hasRecords: c._count.records > 0,
  }))

  // Every currently-taken Sanctuary map region, across all sections — used
  // both by each section's Add form and by the Edit dialog (which can move
  // any category INTO Sanctuary, not just edit ones already there).
  const sanctuarySvgKeys = categories
    .filter((c): c is CategoryRowData & { svgKey: string } => c.type === 'SECTION' && c.isActive && Boolean(c.svgKey))
    .map((c) => ({ id: c.id, svgKey: c.svgKey }))

  const categoryTypes = Object.keys(TYPE_LABELS) as CategoryType[]

  return (
    <>
      <AppHeader helpAnchor="categories" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

        {categoryTypes.map((type) => (
          <CategorySection
            key={type}
            type={type}
            label={TYPE_LABELS[type]}
            categories={categories.filter((c) => c.type === type)}
            sanctuarySvgKeys={sanctuarySvgKeys}
          />
        ))}

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
    </>
  )
}
