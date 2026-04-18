import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CompetitorMatrix from '../CompetitorMatrix'

const THREE_BRAND_FIXTURE = `## 4. ブランド別評価

### カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | 指名 | 確認済み |
| FV訴求 | 同等 | 標準 | 推定 |
| CTA明確性 | 弱 | 分散 | 確認済み |
| 信頼構築 | 同等 | 実績 | 確認済み |
| 価格・オファー | 弱 | 非表示 | 確認済み |
| 購買導線 | 同等 | カート | 確認済み |

### キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | C | 確認済み |
| FV訴求 | 強 | D | 確認済み |
| CTA明確性 | 強 | E | 確認済み |
| 信頼構築 | 強 | F | 確認済み |
| 価格・オファー | 強 | G | 確認済み |
| 購買導線 | 強 | H | 確認済み |

### ヨドバシカメラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | I | 確認済み |
| FV訴求 | 同等 | J | 推定 |
| CTA明確性 | 強 | K | 確認済み |
| 信頼構築 | 強 | L | 確認済み |
| 価格・オファー | 同等 | M | 確認済み |
| 購買導線 | 強 | N | 確認済み |

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

describe('CompetitorMatrix', () => {
  it('renders a row for each of the 3 brands when headings use ###', () => {
    render(<CompetitorMatrix reportMd={THREE_BRAND_FIXTURE} />)
    expect(screen.getByText('カメラの大林')).toBeInTheDocument()
    expect(screen.getByText('キタムラ')).toBeInTheDocument()
    expect(screen.getByText('ヨドバシカメラ')).toBeInTheDocument()
  })

  it('renders all 3 brands even when brand headings are promoted to ##', () => {
    render(<CompetitorMatrix reportMd={PROMOTED_FIXTURE} />)
    expect(screen.getByText('カメラの大林')).toBeInTheDocument()
    expect(screen.getByText('キタムラ')).toBeInTheDocument()
    expect(screen.getByText('ヨドバシ')).toBeInTheDocument()
  })

  it('renders nothing when no brand evaluation section is present', () => {
    const { container } = render(<CompetitorMatrix reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
