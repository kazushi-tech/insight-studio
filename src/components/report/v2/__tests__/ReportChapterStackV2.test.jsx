import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ReportChapterStackV2 from '../ReportChapterStackV2'

const ENVELOPE = {
  priority_actions: [
    {
      title: 'FVのCTAを一本化',
      owner_area: 'LP改善',
      expected_kpi: 'CVR +0.4pt',
      first_task: '自社LPのCTA文言を1案に絞る',
      confidence: 'high',
      impact: 84,
    },
  ],
  evidence_items: [
    {
      label: 'FV CTA',
      observation: '主CTAが分散',
      evidence_level: 'confirmed',
    },
  ],
  brand_evaluations: [
    {
      brand: '自社LP',
      role: 'direct',
      axes: [
        { axis: '検索意図一致', verdict: '弱', evidence: '確認済み' },
        { axis: '信頼構築', verdict: '同等', evidence: '確認済み' },
      ],
    },
    {
      brand: 'direct.example.jp',
      competitor_tier: 'direct',
      classification_reason: '同じ商材でCV導線を比較できる',
      axes: [
        { axis: '検索意図一致', verdict: '強', evidence: '確認済み' },
        { axis: '信頼構築', verdict: '強', evidence: '確認済み' },
      ],
    },
    {
      brand: 'vertexaisearch.cloud.google.com',
      competitor_tier: 'direct',
      classification_reason: '検索/クラウド系URLのため対象外',
      axes: [],
    },
  ],
}

const MD = `# 比較レポート

## 総評
自社LPはCTAの整理と信頼訴求の追加で改善余地があります。

## 実行プラン
- FVのCTAを一本化: CVR改善を狙う
`

describe('ReportChapterStackV2', () => {
  it('renders compare report as a scrollable four-step flow', () => {
    render(<ReportChapterStackV2 envelope={ENVELOPE} reportMd={MD} kind="compare" />)

    expect(screen.getByText('比較レポートの読み順')).toBeInTheDocument()
    expect(screen.getByText('比較対象を先に確認')).toBeInTheDocument()
    expect(screen.getByText('Markdownで読める説明')).toBeInTheDocument()
    expect(screen.getByText('文章の要点をグラフ化')).toBeInTheDocument()
    expect(screen.getByText('次にやることへ落とす')).toBeInTheDocument()
    expect(screen.getByText('CVR +0.4pt')).toBeInTheDocument()
  })

  it('keeps out-of-scope discovery candidates out of the main comparison bars', () => {
    render(<ReportChapterStackV2 envelope={ENVELOPE} reportMd={MD} kind="discovery" />)

    expect(screen.getByText('発見レポートの読み順')).toBeInTheDocument()
    expect(screen.getByText('見つかったURLを分類')).toBeInTheDocument()
    expect(screen.getAllByText('対象外').length).toBeGreaterThan(0)
    expect(screen.getByText('vertexaisearch.cloud.google.com')).toBeInTheDocument()

    const comparisonSection = screen.getByTestId('discovery-comparison-bars')
    expect(within(comparisonSection).queryByText('vertexaisearch.cloud.google.com')).not.toBeInTheDocument()
  })
})
