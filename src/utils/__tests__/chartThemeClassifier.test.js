import { describe, expect, it } from 'vitest'
import { classifyChartTheme, computeThemeSummary, extractTopInsights } from '../chartThemeClassifier'

describe('chartThemeClassifier', () => {
  it('prefers queryType over ambiguous title words', () => {
    expect(classifyChartTheme({ queryType: 'landing', title: '入口ページ — セッション数上位5ページ' })).toBe('lp')
  })

  it('does not interpret category order as a time change', () => {
    const categoryGroup = {
      queryType: 'traffic',
      title: '来訪元ランキング',
      labels: ['organic', 'direct', 'referral'],
      datasets: [{ label: '訪問', data: [100, 60, 10] }],
    }

    expect(extractTopInsights([categoryGroup])).toEqual([])
    expect(computeThemeSummary([categoryGroup])).toEqual({ chartCount: 1, criticalShifts: 0 })
  })
})
