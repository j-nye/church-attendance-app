import { describe, it, expect, vi, beforeEach } from 'vitest'

const allowlistFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowlist: {
      findMany: (...args: unknown[]) => allowlistFindMany(...args),
    },
  },
}))

const { resolveDisplayNames } = await import('@/lib/display-names')

beforeEach(() => {
  allowlistFindMany.mockReset()
})

describe('resolveDisplayNames', () => {
  it('batches into one findMany query, not one per email', async () => {
    allowlistFindMany.mockResolvedValue([
      { email: 'a@example.com', name: 'A Person', adminOverrideName: null },
      { email: 'b@example.com', name: 'B Person', adminOverrideName: null },
      { email: 'c@example.com', name: 'C Person', adminOverrideName: null },
    ])

    const result = await resolveDisplayNames(['a@example.com', 'b@example.com', 'c@example.com'])

    expect(allowlistFindMany).toHaveBeenCalledTimes(1)
    expect(result.get('a@example.com')).toBe('A Person')
    expect(result.get('b@example.com')).toBe('B Person')
    expect(result.get('c@example.com')).toBe('C Person')
  })

  it('resolves an email with no allowlist row to null, never the email string', async () => {
    allowlistFindMany.mockResolvedValue([])

    const result = await resolveDisplayNames(['ghost@example.com'])

    expect(result.get('ghost@example.com')).toBeNull()
    expect(result.get('ghost@example.com')).not.toBe('ghost@example.com')
  })

  it('resolves an email whose row has no name to null, never the email string', async () => {
    allowlistFindMany.mockResolvedValue([
      { email: 'noname@example.com', name: null, adminOverrideName: null },
    ])

    const result = await resolveDisplayNames(['noname@example.com'])

    expect(result.get('noname@example.com')).toBeNull()
    expect(result.get('noname@example.com')).not.toBe('noname@example.com')
  })

  it('prefers adminOverrideName over name when both are set', async () => {
    allowlistFindMany.mockResolvedValue([
      {
        email: 'both@example.com',
        name: 'Google Name',
        adminOverrideName: 'Admin Corrected Name',
      },
    ])

    const result = await resolveDisplayNames(['both@example.com'])

    expect(result.get('both@example.com')).toBe('Admin Corrected Name')
  })

  it('makes zero queries and returns an empty map for empty input', async () => {
    const result = await resolveDisplayNames([])

    expect(allowlistFindMany).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('resolves case-insensitively against the stored email', async () => {
    // recordedBy is always lowercased by requireUser, but an Allowlist row's
    // email is not guaranteed to be stored in that exact case — assert the
    // lookup tolerates the mismatch rather than assuming it can't happen.
    allowlistFindMany.mockResolvedValue([
      { email: 'Jane@EXAMPLE.com', name: 'Jane Volunteer', adminOverrideName: null },
    ])

    const result = await resolveDisplayNames(['jane@example.com'])

    expect(result.get('jane@example.com')).toBe('Jane Volunteer')
  })
})
