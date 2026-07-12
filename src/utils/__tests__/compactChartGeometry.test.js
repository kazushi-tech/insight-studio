import { describe, expect, it } from 'vitest'
import { buildCompactChartGeometry } from '../compactChartGeometry'

describe('buildCompactChartGeometry', () => {
  it('keeps extreme line values inside the viewport', () => {
    const result = buildCompactChartGeometry('line', [{ data: [-1_000_000, 0, 1_000_000] }])
    expect(result.kind).toBe('line')
    expect(result.series[0]).toEqual([
      { x: 0, y: 60 },
      { x: 120, y: 30 },
      { x: 240, y: 0 },
    ])
  })

  it('renders a single point at the center without dividing by zero', () => {
    const result = buildCompactChartGeometry('line', [{ data: [42] }])
    expect(result.series[0]).toEqual([{ x: 120, y: 30 }])
  })

  it('returns an explicit empty model when no finite values exist', () => {
    expect(buildCompactChartGeometry('line', [{ data: [null, 'invalid'] }])).toEqual({
      kind: 'empty',
      series: [],
    })
  })

  it('supports positive and negative horizontal bars within bounds', () => {
    const result = buildCompactChartGeometry('bar_horizontal', [{ data: [-10, 20] }])
    expect(result.kind).toBe('bar')
    result.series.forEach((bar) => {
      expect(bar.x).toBeGreaterThanOrEqual(0)
      expect(bar.width).toBeGreaterThan(0)
      expect(bar.x + bar.width).toBeLessThanOrEqual(240)
    })
  })
})
