import { prisma } from '@/lib/prisma'
import { requireAdmin, AuthzError } from '@/lib/authz'
import { getExportRows, type ExportRow } from '@/lib/actions/attendance'
import { listEventsInRange } from '@/lib/actions/events'
import { toCsv } from '@/lib/csv'

const COLUMNS = [
  'Service Date',
  'Service Name',
  'Archived',
  'Category Type',
  'Group',
  'Category',
  'Count',
  'Counts Toward Total',
  'Recorded By',
]

function toCsvRow(row: ExportRow): Record<string, string> {
  return {
    'Service Date': row.serviceDate,
    'Service Name': row.serviceName,
    Archived: String(row.archived),
    'Category Type': row.categoryType,
    Group: row.group,
    Category: row.categoryName,
    Count: String(row.count),
    'Counts Toward Total': String(row.countsTowardTotal),
    'Recorded By': row.recordedBy,
  }
}

function csvResponse(rows: ExportRow[], filename: string): Response {
  const csv = toCsv(COLUMNS, rows.map(toCsvRow))
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(error.code === 'UNAUTHENTICATED' ? 'Not signed in' : 'Not authorized', {
        status: 403,
      })
    }
    throw error
  }

  const url = new URL(request.url)
  const eventId = url.searchParams.get('eventId')
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')

  const hasEventId = Boolean(eventId)
  const hasRange = Boolean(start) || Boolean(end)

  if (hasEventId === hasRange) {
    return new Response('Provide either eventId, or both start and end — not neither or both', {
      status: 400,
    })
  }

  if (hasEventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId! },
      select: { id: true, serviceDate: true },
    })
    if (!event) return new Response('No such service', { status: 404 })

    const rows = await getExportRows([event.id])
    return csvResponse(rows, `attendance-${event.serviceDate}.csv`)
  }

  if (!start || !end) {
    return new Response('Both start and end are required for a range export', { status: 400 })
  }
  if (start > end) {
    return new Response('start must not be after end', { status: 400 })
  }

  const events = await listEventsInRange(start, end)
  const rows = await getExportRows(events.map((event) => event.id))
  return csvResponse(rows, `attendance-${start}-to-${end}.csv`)
}
