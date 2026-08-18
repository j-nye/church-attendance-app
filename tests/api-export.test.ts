import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const eventFindUnique = vi.fn()
const getExportRows = vi.fn()
const listEventsInRange = vi.fn()

class AuthzError extends Error {
  constructor(public readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN') {
    super(code)
  }
}

vi.mock('@/lib/authz', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  AuthzError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    event: {
      findUnique: (...args: unknown[]) => eventFindUnique(...args),
    },
  },
}))

vi.mock('@/lib/actions/attendance', () => ({
  getExportRows: (...args: unknown[]) => getExportRows(...args),
}))

vi.mock('@/lib/actions/events', () => ({
  listEventsInRange: (...args: unknown[]) => listEventsInRange(...args),
}))

const { GET } = await import('@/app/api/export/route')

beforeEach(() => {
  requireAdmin.mockReset()
  eventFindUnique.mockReset()
  getExportRows.mockReset()
  listEventsInRange.mockReset()
})

function request(query: string) {
  return new Request(`http://localhost/api/export${query}`)
}

describe('GET /api/export', () => {
  it('rejects a non-admin with 403', async () => {
    requireAdmin.mockRejectedValue(new AuthzError('FORBIDDEN'))
    const response = await GET(request('?eventId=e1'))
    expect(response.status).toBe(403)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a request with neither eventId nor a date range with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request(''))
    expect(response.status).toBe(400)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a request with both eventId and a date range with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?eventId=e1&start=2026-08-01&end=2026-08-31'))
    expect(response.status).toBe(400)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('rejects a range request missing end with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?start=2026-08-01'))
    expect(response.status).toBe(400)
    expect(listEventsInRange).not.toHaveBeenCalled()
  })

  it('rejects start after end with 400', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    const response = await GET(request('?start=2026-08-31&end=2026-08-01'))
    expect(response.status).toBe(400)
    expect(listEventsInRange).not.toHaveBeenCalled()
  })

  it('returns 404 for an eventId that does not exist', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue(null)
    const response = await GET(request('?eventId=missing'))
    expect(response.status).toBe(404)
    expect(getExportRows).not.toHaveBeenCalled()
  })

  it('returns a CSV with the right headers for a valid single-event export', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    eventFindUnique.mockResolvedValue({ id: 'e1', serviceDate: '2026-08-16' })
    getExportRows.mockResolvedValue([
      {
        serviceDate: '2026-08-16',
        serviceName: 'Sunday Service',
        archived: false,
        categoryType: 'SECTION',
        group: 'Sanctuary',
        categoryName: 'Left Wing',
        count: 5,
        countsTowardTotal: true,
        recordedBy: 'vol@example.com',
      },
    ])

    const response = await GET(request('?eventId=e1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="attendance-2026-08-16.csv"'
    )
    const body = await response.text()
    expect(body).toContain('Service Date,Service Name,Archived,Category Type,Group,Category,Count,Counts Toward Total,Recorded By')
    expect(body).toContain('2026-08-16,Sunday Service,false,SECTION,Sanctuary,Left Wing,5,true,vol@example.com')
    expect(getExportRows).toHaveBeenCalledWith(['e1'])
  })

  it('returns a 200 header-only CSV for a valid range matching zero events', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    listEventsInRange.mockResolvedValue([])
    getExportRows.mockResolvedValue([])

    const response = await GET(request('?start=2020-01-01&end=2020-01-31'))

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe(
      'Service Date,Service Name,Archived,Category Type,Group,Category,Count,Counts Toward Total,Recorded By\r\n'
    )
  })

  it('builds the range filename from start and end, and passes every matched event id to getExportRows', async () => {
    requireAdmin.mockResolvedValue({ email: 'admin@example.com', role: 'ADMIN' })
    listEventsInRange.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    getExportRows.mockResolvedValue([])

    const response = await GET(request('?start=2026-08-01&end=2026-08-31'))

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="attendance-2026-08-01-to-2026-08-31.csv"'
    )
    expect(getExportRows).toHaveBeenCalledWith(['e1', 'e2'])
  })
})
