import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'

describe('prisma singleton', () => {
  it('exposes model delegates for every schema model', () => {
    expect(prisma.allowlist).toBeDefined()
    expect(prisma.event).toBeDefined()
    expect(prisma.category).toBeDefined()
    expect(prisma.attendanceRecord).toBeDefined()
  })

  it('reuses the same client instance across imports (no per-import pool)', async () => {
    const { prisma: prismaAgain } = await import('@/lib/prisma')
    expect(prismaAgain).toBe(prisma)
  })

  it('caches the client on globalThis outside production, to survive hot reloads', () => {
    const globalForPrisma = globalThis as unknown as { prisma?: typeof prisma }
    if (process.env.NODE_ENV !== 'production') {
      expect(globalForPrisma.prisma).toBe(prisma)
    }
  })
})
