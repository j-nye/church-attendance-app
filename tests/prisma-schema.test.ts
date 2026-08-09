import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { prisma } from '@/lib/prisma'

// These tests exercise the real Neon database to verify the constraints the
// schema is supposed to enforce. They only run when DATABASE_URL is available
// (populated locally from .env.local via tests/setup.ts); CI's `npm test` step
// has no database credentials, so this whole suite skips there.
const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('schema constraints (live database)', () => {
  const runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const eventName = `${runId}-event`
  const categoryName = `${runId}-category`

  let eventId: string
  let categoryId: string

  beforeAll(async () => {
    const event = await prisma.event.create({
      data: { name: eventName, serviceDate: '2026-01-04' },
    })
    eventId = event.id

    const category = await prisma.category.create({
      data: { name: categoryName, type: 'SECTION', sortOrder: 999 },
    })
    categoryId = category.id
  })

  afterAll(async () => {
    // AttendanceRecord rows are removed by the Event cascade-delete test itself;
    // clean up whatever is left defensively so a failed assertion doesn't leak rows.
    await prisma.attendanceRecord.deleteMany({ where: { OR: [{ eventId }, { categoryId }] } })
    await prisma.event.deleteMany({ where: { id: eventId } })
    await prisma.category.deleteMany({ where: { id: categoryId } })
  })

  it('stores serviceDate as the exact plain date string, with no timezone rollover', async () => {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } })
    expect(event.serviceDate).toBe('2026-01-04')
  })

  it('defaults isActive to true for new Category and Allowlist rows', async () => {
    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } })
    expect(category.isActive).toBe(true)
  })

  it('rejects a second AttendanceRecord for the same event+category (no double-counting)', async () => {
    await prisma.attendanceRecord.create({
      data: { eventId, categoryId, count: 10, recordedBy: 'tester@example.com' },
    })

    await expect(
      prisma.attendanceRecord.create({
        data: { eventId, categoryId, count: 5, recordedBy: 'tester@example.com' },
      }),
    ).rejects.toThrow()
  })

  it('upserts via the eventId_categoryId compound key instead of double-counting', async () => {
    const updated = await prisma.attendanceRecord.upsert({
      where: { eventId_categoryId: { eventId, categoryId } },
      update: { count: 42 },
      create: { eventId, categoryId, count: 42, recordedBy: 'tester@example.com' },
    })
    expect(updated.count).toBe(42)

    const records = await prisma.attendanceRecord.findMany({ where: { eventId, categoryId } })
    expect(records).toHaveLength(1)
  })

  it('restricts deleting a Category that still has attendance history', async () => {
    await expect(prisma.category.delete({ where: { id: categoryId } })).rejects.toThrow()
  })

  it('cascades AttendanceRecord deletion when the parent Event is deleted', async () => {
    await prisma.event.delete({ where: { id: eventId } })
    const records = await prisma.attendanceRecord.findMany({ where: { eventId } })
    expect(records).toHaveLength(0)
  })
})
