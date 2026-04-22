import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('chart.js', () => {
  class MockChart {
    constructor() {
      this.data = {}
    }
    update() {}
    destroy() {}
  }
  MockChart.register = vi.fn()
  MockChart.defaults = { font: {}, plugins: {} }
  return {
    Chart: MockChart,
    RadarController: {},
    RadialLinearScale: {},
    PointElement: {},
    LineElement: {},
    Filler: {},
    Tooltip: {},
    Legend: {},
  }
})

import BrandRadarV2 from '../BrandRadarV2'

const ENVELOPE = {
  brand_evaluations: [
    {
      brand: 'カメラの大林',
      axes: [
        { axis: '検索意図一致', verdict: '強' },
        { axis: 'FV訴求', verdict: '同等' },
      ],
    },
    {
      brand: 'キタムラ',
      axes: [
        { axis: '検索意図一致', verdict: '同等' },
        { axis: 'FV訴求', verdict: '強' },
      ],
    },
  ],
}

const MD_FIXTURE = `## 4. ブランド別評価

### カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | a | 確認済み |

### キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | b | 確認済み |

### ヨドバシ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | c | 確認済み |

## 5. 実行プラン
`

describe('BrandRadarV2', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders brand toggle buttons from ReportEnvelope', () => {
    render(<BrandRadarV2 envelope={ENVELOPE} reportMd="" />)
    expect(screen.getByRole('button', { name: 'カメラの大林' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キタムラ' })).toBeInTheDocument()
  })

  it('falls back to markdown when envelope empty (all 3 brands visible)', () => {
    render(<BrandRadarV2 envelope={null} reportMd={MD_FIXTURE} />)
    expect(screen.getByRole('button', { name: 'カメラの大林' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キタムラ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ヨドバシ' })).toBeInTheDocument()
  })

  it('renders nothing when no data', () => {
    const { container } = render(<BrandRadarV2 envelope={null} reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
