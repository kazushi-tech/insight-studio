import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  buildReportSearchParams,
  normalizeReportFilters,
  normalizeReportPeriod,
  normalizeReportTheme,
  normalizeReportView,
  useReportFilters,
} from '../useReportFilters'

describe('report filter normalization', () => {
  it('keeps supported values and falls back for invalid values', () => {
    expect(normalizeReportPeriod('2026-06', ['2026-05', '2026-06'])).toBe('2026-06')
    expect(normalizeReportPeriod('2024-01', ['2026-05', '2026-06'])).toBe('latest')
    expect(normalizeReportTheme('landing')).toBe('lp')
    expect(normalizeReportTheme('unknown-theme')).toBe('all')
    expect(normalizeReportView('exec')).toBe('summary')
    expect(normalizeReportView('analyst')).toBe('analyst')
  })

  it('reads period, theme and view from one URL contract', () => {
    const filters = normalizeReportFilters(
      '?period=2026-06&theme=traffic&view=analyst',
      { availablePeriods: ['2026-06'], availableThemes: ['traffic', 'lp'] },
    )
    expect(filters).toEqual({ period: '2026-06', theme: 'traffic', view: 'analyst' })
  })

  it('preserves unrelated parameters and supports deleting a filter', () => {
    const next = buildReportSearchParams(
      '?question=why&period=latest&theme=traffic',
      { period: '2026-06', theme: null, view: 'analyst' },
      { availablePeriods: ['2026-06'], availableThemes: ['traffic'] },
    )

    expect(next.get('question')).toBe('why')
    expect(next.get('period')).toBe('2026-06')
    expect(next.has('theme')).toBe(false)
    expect(next.get('view')).toBe('analyst')
  })
})
describe('useReportFilters', () => {
  it('updates URL-backed filters and keeps unrelated query state', () => {
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/ads/graphs?period=latest&source=report']}>
        {children}
      </MemoryRouter>
    )
    const options = {
      availablePeriods: ['2026-06'],
      availableThemes: ['traffic', 'lp'],
    }
    const { result } = renderHook(() => useReportFilters(options), { wrapper })

    act(() => result.current.setFilters({ period: '2026-06', theme: 'traffic', view: 'analyst' }))

    expect(result.current).toMatchObject({
      period: '2026-06',
      theme: 'traffic',
      view: 'analyst',
    })
    expect(result.current.searchParams.get('source')).toBe('report')
  })
})
