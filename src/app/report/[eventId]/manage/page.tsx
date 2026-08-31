import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { getManageRows } from '@/lib/actions/attendance'
import { formatServiceDate } from '@/lib/dates'
import { ManageTable } from '@/components/ManageTable'

export default async function ManagePage({ params }: { params: Promise<{ eventId: string }> }) {
  // Page-level gate. getManageRows and deleteCount each re-check independently —
  // this call is convenience, not the boundary (same pattern as /settings).
  await requireAdmin()
  const { eventId } = await params

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event) notFound()

  const rows = await getManageRows(eventId)
  // Dates aren't plain-serializable across the server/client boundary in a
  // form ManageTable should have to know about — convert once, here.
  const tableRows = rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
  }))

  return (
    <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>Manage attendance records</p>
      <ManageTable eventId={eventId} rows={tableRows} />
    </main>
  )
}
