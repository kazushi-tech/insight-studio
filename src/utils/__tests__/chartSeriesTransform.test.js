import { describe, expect, it } from 'vitest'
import { buildSvgAreaPath, buildSvgPath } from '../chartSeriesTransform'

describe('buildSvgPath', () => {
  it('starts a new line segment after a missing value', () => {
    const path = buildSvgPath(
      [10, null, 30, 40],
      { min: 0, max: 40 },
      { x: 0, y: 0, width: 300, height: 100 },
    )

    expect(path.match(/\bM\b/g)).toHaveLength(2)
    expect(path.match(/\bL\b/g)).toHaveLength(1)
  })

  it('returns an empty path when every value is missing', () => {
    expect(buildSvgPath([null, null], { min: 0, max: 1 }, { x: 0, y: 0, width: 100, height: 100 })).toBe('')
  })
})

describe('buildSvgAreaPath', () => {
  it('closes separate filled areas around a missing value', () => {
    const path = buildSvgAreaPath(
      [10, 20, null, 30, 40],
      { min: 0, max: 40 },
      { x: 0, y: 0, width: 400, height: 100 },
    )

    expect(path.match(/\bM\b/g)).toHaveLength(2)
    expect(path.match(/\bZ\b/g)).toHaveLength(2)
  })

  it('returns an empty area when every value is missing', () => {
    expect(buildSvgAreaPath([null, null], { min: 0, max: 1 }, { x: 0, y: 0, width: 100, height: 100 })).toBe('')
  })
})
