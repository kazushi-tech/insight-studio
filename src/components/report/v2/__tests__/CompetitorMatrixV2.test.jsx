import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CompetitorMatrixV2 from '../CompetitorMatrixV2'

const ENVELOPE = {
  brand_evaluations: [
    {
      brand: 'カメラの大林',
      axes: [
        { axis: '検索意図一致', verdict: '強', reason: '指名ワードがFVに出る', evidence: '確認済み' },
        { axis: 'FV訴求', verdict: '同等', reason: '標準', evidence: '推定' },
        { axis: 'CTA明確性', verdict: '弱', reason: '分散', evidence: '確認済み' },
        { axis: '信頼構築', verdict: '同等', reason: '実績', evidence: '確認済み' },
        { axis: '価格・オファー', verdict: '弱', reason: '非表示', evidence: '確認済み' },
        { axis: '購買導線', verdict: '同等', reason: 'カート', evidence: '確認済み' },
      ],
    },
    {
      brand: 'キタムラ',
      axes: [
        { axis: '検索意図一致', verdict: '同等', reason: 'C', evidence: '確認済み' },
        { axis: 'FV訴求', verdict: '強', reason: 'D', evidence: '確認済み' },
        { axis: 'CTA明確性', verdict: '強', reason: 'E', evidence: '確認済み' },
        { axis: '信頼構築', verdict: '強', reason: 'F', evidence: '確認済み' },
        { axis: '価格・オファー', verdict: '強', reason: 'G', evidence: '確認済み' },
        { axis: '購買導線', verdict: '強', reason: 'H', evidence: '確認済み' },
      ],
    },
  ],
}

const THREE_BRAND_FIXTURE = `## 4. ブランド別評価

### カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | a | 確認済み |

### キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | b | 確認済み |

### ヨドバシカメラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | c | 確認済み |

## 5. 実行プラン
`

describe('CompetitorMatrixV2', () => {
  it('prefers ReportEnvelope brand_evaluations when present', () => {
    render(<CompetitorMatrixV2 envelope={ENVELOPE} reportMd="" />)
    expect(screen.getByText('カメラの大林')).toBeInTheDocument()
    expect(screen.getByText('キタムラ')).toBeInTheDocument()
  })

  it('falls back to markdown parsing when envelope is null (all 3 brands)', () => {
    render(<CompetitorMatrixV2 envelope={null} reportMd={THREE_BRAND_FIXTURE} />)
    expect(screen.getByText('カメラの大林')).toBeInTheDocument()
    expect(screen.getByText('キタムラ')).toBeInTheDocument()
    expect(screen.getByText('ヨドバシカメラ')).toBeInTheDocument()
  })

  it('renders nothing when no data available', () => {
    const { container } = render(<CompetitorMatrixV2 envelope={null} reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
