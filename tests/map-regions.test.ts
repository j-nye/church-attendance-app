import { describe, expect, it } from 'vitest'
import { MAP_REGIONS, MAP_VIEWBOX } from '@/lib/map-regions'

describe('MAP_REGIONS', () => {
  it('exposes the fixed 600x420 viewBox', () => {
    expect(MAP_VIEWBOX).toBe('0 0 600 420')
  })

  it('has a unique key for every region', () => {
    const keys = MAP_REGIONS.map((region) => region.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every region a label and non-negative geometry', () => {
    for (const region of MAP_REGIONS) {
      expect(region.label.length).toBeGreaterThan(0)
      expect(region.x).toBeGreaterThanOrEqual(0)
      expect(region.y).toBeGreaterThanOrEqual(0)
      expect(region.width).toBeGreaterThan(0)
      expect(region.height).toBeGreaterThan(0)
    }
  })

  it('keeps every region within the 600x420 viewBox bounds', () => {
    for (const region of MAP_REGIONS) {
      expect(region.x + region.width).toBeLessThanOrEqual(600)
      expect(region.y + region.height).toBeLessThanOrEqual(420)
    }
  })
})
