import { EntryClient } from './EntryClient'
import { listActiveCategories } from '@/lib/actions/categories'
import { getEventCounts } from '@/lib/actions/attendance'
import { listSpeakers } from '@/lib/actions/speakers'
import { prisma } from '@/lib/prisma'
import { requireUserPage } from '@/lib/authz'
import { formatServiceDate } from '@/lib/dates'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'

export default async function EntryPage({ params }: { params: Promise<{ eventId: string }> }) {
  await requireUserPage()
  const { eventId } = await params

  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.isArchived) notFound()

  const [categories, counts, speakers] = await Promise.all([
    listActiveCategories(),
    getEventCounts(eventId),
    listSpeakers(eventId),
  ])

  return (
    <>
      <AppHeader helpAnchor="counting" />
      <main style={{ padding: 'var(--space-4)', maxWidth: '48rem', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>{event.name}</h1>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatServiceDate(event.serviceDate)}</p>
        <EntryClient eventId={eventId} categories={categories} initialCounts={counts} initialSpeakers={speakers} />
      </main>
    </>
  )
}
