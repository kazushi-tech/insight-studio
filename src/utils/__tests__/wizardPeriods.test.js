import { describe, expect, it } from 'vitest'
import { latestPeriodValue, periodRangeLabel } from '../wizardPeriods'

describe('latestPeriodValue', () => {
  it('selects the newest ISO period regardless of API ordering', () => {
    expect(latestPeriodValue(['2026-06', '2026-05'])).toBe('2026-06')
    expect(latestPeriodValue(['2026-05', '2026-06'])).toBe('2026-06')
    expect(latestPeriodValue([
      { period_tag: '2026-05' },
      { period_tag: '2026-06' },
    ])).toBe('2026-06')
  })

  it('returns null when no usable period exists', () => {
    expect(latestPeriodValue([])).toBeNull()
    expect(latestPeriodValue(null)).toBeNull()
  })
})

describe('periodRangeLabel', () => {
  it('shows the range from oldest to newest even when API periods are newest-first', () => {
    expect(periodRangeLabel(['2026-06', '2026-05'])).toBe('2026-05 〜 2026-06')
  })

  it('returns a single period or null for compact states', () => {
    expect(periodRangeLabel(['2026-06'])).toBe('2026-06')
    expect(periodRangeLabel([])).toBeNull()
  })
})
