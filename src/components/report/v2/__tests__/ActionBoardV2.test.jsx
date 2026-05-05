import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ActionBoardV2 from '../ActionBoardV2'

describe('ActionBoardV2', () => {
  it('renders a decision-first board from ReportEnvelope actions', () => {
    render(
      <ActionBoardV2
        reportMd=""
        envelope={{
          priority_actions: [
            {
              title: 'FVのCTAを一本化',
              detail: 'ファーストビューのCTAが分散しているため、主要CVへ寄せる',
              owner_area: '広告文',
              expected_kpi: 'CVR改善',
              first_task: 'FVのCTA文言を1案に絞る',
              confidence: 'high',
              impact: 84,
              effort: 35,
            },
          ],
          evidence_items: [
            {
              label: 'FV CTA',
              observation: 'CTAが複数あり、主導線が分散',
              evidence_level: 'confirmed',
            },
          ],
          brand_evaluations: [
            {
              brand: '競合A',
              role: 'direct',
              axes: [
                { axis: '検索意図一致', verdict: '強', evidence: '確認済み' },
                { axis: 'CTA明確性', verdict: '弱', evidence: '推定' },
              ],
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('action-board-v2')).toBeInTheDocument()
    expect(screen.getByText('Action Board / Decision Board')).toBeInTheDocument()
    expect(screen.getByText('FVのCTAを一本化')).toBeInTheDocument()
    expect(screen.getByText('担当領域')).toBeInTheDocument()
    expect(screen.getByText('広告文')).toBeInTheDocument()
    expect(screen.getByText('CVR改善')).toBeInTheDocument()
    expect(screen.getByText('初回タスク')).toBeInTheDocument()
    expect(screen.getByText(/信頼度 高/)).toBeInTheDocument()
    expect(screen.getByText('Priority Matrix')).toBeInTheDocument()
    expect(screen.getByText('Evidence Chips')).toBeInTheDocument()
    expect(screen.getByText('直接競合')).toBeInTheDocument()
  })

  it('surfaces classification risk when out-of-scope competitors are present', () => {
    render(
      <ActionBoardV2
        reportMd=""
        envelope={{
          priority_actions: [
            { title: '比較対象を整理', expected_kpi: 'CPA悪化要因を切り分け', first_task: '対象外URLを除外する' },
          ],
          brand_evaluations: [
            { brand: '自社', role: 'direct', axes: [] },
            { brand: 'vertexaisearch.cloud.google.com', role: 'direct', axes: [] },
          ],
        }}
      />,
    )

    expect(screen.getByText('競合分類の確認が必要')).toBeInTheDocument()
    expect(screen.getByText(/対象外 1 件/)).toBeInTheDocument()
  })

  it('falls back to markdown priority actions', () => {
    const md = `## 実行プラン

- CTA改善: CVR改善を狙ってボタン文言を変更
- 信頼訴求: 導入事例を追加
`
    render(<ActionBoardV2 envelope={null} reportMd={md} />)
    expect(screen.getByText('CTA改善')).toBeInTheDocument()
    expect(screen.getByText('次点施策')).toBeInTheDocument()
  })
})
