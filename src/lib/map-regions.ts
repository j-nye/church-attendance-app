/**
 * Fixed top-down geometry of the building, in a 600x420 SVG viewBox.
 * Adjust these numbers to match your sanctuary; a Category is placed on the
 * map by setting its `svgKey` to one of these keys.
 */
export const MAP_REGIONS = [
  { key: 'stage', label: 'Stage', x: 180, y: 20, width: 240, height: 50 },
  { key: 'left-wing', label: 'Left Wing', x: 20, y: 100, width: 130, height: 300 },
  { key: 'center-left', label: 'Center Left', x: 165, y: 100, width: 130, height: 300 },
  { key: 'center-right', label: 'Center Right', x: 310, y: 100, width: 130, height: 300 },
  { key: 'right-wing', label: 'Right Wing', x: 455, y: 100, width: 125, height: 300 },
] as const

export type MapRegion = (typeof MAP_REGIONS)[number]
export const MAP_VIEWBOX = '0 0 600 420'
