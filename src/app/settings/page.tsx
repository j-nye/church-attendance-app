import { requireAdminPage } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { listAllowlist } from '@/lib/actions/allowlist'
import { listRecentEvents } from '@/lib/actions/events'
import { nextSundayServiceDate } from '@/lib/dates'
import { AllowlistSection, type AllowlistRowData } from '@/components/AllowlistSection'
import { AppHeader } from '@/components/AppHeader'
import { CategorySection, type CategoryRowData } from '@/components/CategorySection'
import { ServicesSection, type ServiceRowData } from '@/components/ServicesSection'
import { TYPE_LABELS } from '@/lib/category-labels'
import type { CategoryType } from '@prisma/client'

export default async function SettingsPage() {
  // Page-level gate. The actions below each re-check independently — this
  // call is convenience, not the boundary. On AuthzError it redirects to
  // /denied instead of leaving Next's raw error screen as the only outcome.
  await requireAdminPage()

  const [categoryRecords, allowlist, events] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { records: true } } },
    }),
    listAllowlist(),
    listRecentEvents(),
  ])

  const services: ServiceRowData[] = events.map((e) => ({
    id: e.id,
    name: e.name,
    serviceDate: e.serviceDate,
    startTime: e.startTime,
    isArchived: e.isArchived,
    isCountingDone: e.isCountingDone,
  }))
  const defaultServiceDate = nextSundayServiceDate()

  const allowlistRows: AllowlistRowData[] = allowlist.map((a) => ({
    id: a.id,
    email: a.email,
    role: a.role,
    isActive: a.isActive,
    name: a.name,
    adminOverrideName: a.adminOverrideName,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }))

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

        <ServicesSection services={services} defaultServiceDate={defaultServiceDate} />

        {categoryTypes.map((type) => (
          <CategorySection
            key={type}
            type={type}
            label={TYPE_LABELS[type]}
            categories={categories.filter((c) => c.type === type)}
            sanctuarySvgKeys={sanctuarySvgKeys}
          />
        ))}

        <AllowlistSection entries={allowlistRows} />

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
