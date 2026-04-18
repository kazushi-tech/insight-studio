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

import BrandRadarChart from '../BrandRadarChart'

const THREE_BRAND_FIXTURE = `## 4. ブランド別評価

### カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | a | 確認済み |
| FV訴求 | 同等 | b | 推定 |
| CTA明確性 | 弱 | c | 確認済み |
| 信頼構築 | 同等 | d | 確認済み |
| 価格・オファー | 弱 | e | 確認済み |
| 購買導線 | 同等 | f | 確認済み |

### キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | g | 確認済み |
| FV訴求 | 強 | h | 確認済み |
| CTA明確性 | 強 | i | 確認済み |
| 信頼構築 | 強 | j | 確認済み |
| 価格・オファー | 強 | k | 確認済み |
| 購買導線 | 強 | l | 確認済み |

### ヨドバシカメラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | m | 確認済み |
| FV訴求 | 同等 | n | 推定 |
| CTA明確性 | 強 | o | 確認済み |
| 信頼構築 | 強 | p | 確認済み |
| 価格・オファー | 同等 | q | 確認済み |
| 購買導線 | 強 | r | 確認済み |

## 5. 実行プラン
`

const PROMOTED_FIXTURE = `## 4. ブランド別評価

## カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | a | 確認済み |

## キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | b | 確認済み |

## ヨドバシ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | c | 推定 |

## 実行プラン
`

describe('BrandRadarChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a selection button for each of the 3 brands', () => {
    render(<BrandRadarChart reportMd={THREE_BRAND_FIXTURE} />)
    expect(screen.getByRole('button', { name: 'カメラの大林' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キタムラ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ヨドバシカメラ' })).toBeInTheDocument()
  })

  it('renders all 3 brands even when brand headings are promoted to ##', () => {
    render(<BrandRadarChart reportMd={PROMOTED_FIXTURE} />)
    expect(screen.getByRole('button', { name: 'カメラの大林' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キタムラ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ヨドバシ' })).toBeInTheDocument()
  })

  it('renders nothing when no brand evaluation section is present', () => {
    const { container } = render(<BrandRadarChart reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
