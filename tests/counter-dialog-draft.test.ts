import { describe, expect, it } from 'vitest'
import { draftKeyFor, resolveInitialCount } from '@/components/CounterDialog'

describe('draftKeyFor', () => {
  it('scopes the draft key to both the event and the category', () => {
    expect(draftKeyFor('event-1', 'cat-1')).toBe('draft:event-1:cat-1')
    expect(draftKeyFor('event-1', 'cat-2')).not.toBe(draftKeyFor('event-1', 'cat-1'))
    expect(draftKeyFor('event-2', 'cat-1')).not.toBe(draftKeyFor('event-1', 'cat-1'))
  })
})

describe('resolveInitialCount', () => {
  it('falls back to the server initialCount when no draft exists', () => {
    expect(resolveInitialCount(null, 7)).toBe(7)
  })

  it('prefers a valid local draft over the server initialCount', () => {
    // This is the bug the coordinator flagged: a draft written by bump()
    // must actually be read back, not silently discarded on remount.
    expect(resolveInitialCount('12', 7)).toBe(12)
  })

  it('accepts a draft of zero', () => {
    expect(resolveInitialCount('0', 7)).toBe(0)
  })

  it('falls back to initialCount for a corrupted or non-numeric draft', () => {
    expect(resolveInitialCount('not-a-number', 7)).toBe(7)
    expect(resolveInitialCount('', 7)).toBe(7)
  })

  it('falls back to initialCount for a negative or non-integer draft', () => {
    expect(resolveInitialCount('-3', 7)).toBe(7)
    expect(resolveInitialCount('4.5', 7)).toBe(7)
  })
})
