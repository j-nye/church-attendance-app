import { requireAdmin } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { createCategory, deactivateCategory } from '@/lib/actions/categories'
import { addAllowlistEntry, deactivateAllowlistEntry, listAllowlist } from '@/lib/actions/allowlist'
import { MAP_REGIONS } from '@/lib/map-regions'

export default async function SettingsPage() {
  // Page-level gate. The actions below each re-check independently —
  // this call is convenience, not the boundary.
  await requireAdmin()

  const [categories, allowlist] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] }),
    listAllowlist(),
  ])

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>

      <section className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ marginTop: 0 }}>Add a category</h2>
        <form
          action={async (formData: FormData) => {
            'use server'
            await createCategory({
              name: formData.get('name'),
              type: formData.get('type'),
              svgKey: (formData.get('svgKey') as string) || null,
              countsTowardTotal: formData.get('countsTowardTotal') === 'on',
            })
          }}
          style={{ display: 'grid', gap: 'var(--space-3)' }}
        >
          <input name="name" placeholder="Name" required maxLength={60} style={{ padding: 'var(--space-3)' }} />
          <select name="type" required style={{ padding: 'var(--space-3)' }}>
            <option value="SECTION">Sanctuary section</option>
            <option value="CLASSROOM">Classroom</option>
            <option value="GROWTH_TRACK">Growth Track</option>
            <option value="SERVE_TEAM">Serve team</option>
            <option value="SERVICE_METRIC">Ministry metric</option>
          </select>
          <select name="svgKey" style={{ padding: 'var(--space-3)' }}>
            <option value="">Not on the map (shows in the list)</option>
            {MAP_REGIONS.map((region) => (
              <option key={region.key} value={region.key}>{region.label}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" name="countsTowardTotal" defaultChecked />
            Counts toward Total Attendance
          </label>
          <button type="submit">Add category</button>
        </form>
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
        <form
          action={async (formData: FormData) => {
            'use server'
            await addAllowlistEntry({ email: formData.get('email'), role: formData.get('role') })
          }}
          style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
        >
          <input name="email" type="email" placeholder="person@example.com" required style={{ padding: 'var(--space-3)' }} />
          <select name="role" required style={{ padding: 'var(--space-3)' }}>
            <option value="VOLUNTEER">Volunteer</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button type="submit">Authorize</button>
        </form>

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
    </main>
  )
}
