import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CompetitivePositionMapV2 from '../CompetitivePositionMapV2'

const ENVELOPE = {
  brand_evaluations: [
    {
      brand: '自社',
      role: 'direct',
      axes: [
        { axis: '検索意図一致', verdict: '強', evidence: '確認済み' },
        { axis: 'CTA明確性', verdict: '同等', evidence: '確認済み' },
        { axis: '購買導線', verdict: '同等', evidence: '推定' },
        { axis: '信頼構築', verdict: '弱', evidence: '推定' },
      ],
    },
    {
      brand: '隣接ブランド',
      role: 'adjacent',
      classification_reason: '同じ購買検討層だが主商材が異なる',
      axes: [
        { axis: '検索意図一致', verdict: '同等', evidence: '推定' },
        { axis: 'CTA明確性', verdict: '強', evidence: '確認済み' },
        { axis: '信頼構築', verdict: '強', evidence: '確認済み' },
      ],
    },
    {
      brand: '対象外メディア',
      role: 'out_of_scope',
      axes: [
        { axis: '検索意図一致', verdict: '弱', evidence: '推定' },
      ],
    },
  ],
}

describe('CompetitivePositionMapV2', () => {
  it('renders direct and adjacent competitors and excludes out-of-scope sites', () => {
    render(<CompetitivePositionMapV2 envelope={ENVELOPE} reportMd="" />)
    expect(screen.getByTestId('competitive-position-map-v2')).toBeInTheDocument()
    expect(screen.getByText('Competitor Position Map — 競合ポジション')).toBeInTheDocument()
    expect(screen.getAllByText('自社').length).toBeGreaterThan(0)
    expect(screen.getAllByText('隣接ブランド').length).toBeGreaterThan(0)
    expect(screen.queryByText('対象外メディア')).not.toBeInTheDocument()
  })
})
