import { describe, it, expect } from 'vitest'
import {
  AXIS_KEYS,
  findBrandEvalSectionBody,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../brandEvalParser'

const THREE_BRAND_FIXTURE = `# レポート
## 1. エグゼクティブサマリー
本件の要約。

## 4. ブランド別評価

### カメラの大林（入力ブランド）
**要約**: 入力ブランドの位置づけ。

| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | 指名クエリ対応 | 確認済み |
| FV訴求 | 同等 | 標準的 | 推定 |
| CTA明確性 | 弱 | CTA分散 | 確認済み |
| 信頼構築 | 同等 | 実績記載 | 確認済み |
| 価格・オファー | 弱 | 価格非表示 | 確認済み |
| 購買導線 | 同等 | カート導線あり | 確認済み |

### キタムラ
**要約**: 大手競合。

| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | 幅広対応 | 確認済み |
| FV訴求 | 強 | 明確な訴求 | 確認済み |
| CTA明確性 | 強 | 購入導線明確 | 確認済み |
| 信頼構築 | 強 | 大手実績 | 確認済み |
| 価格・オファー | 強 | 価格表示 | 確認済み |
| 購買導線 | 強 | 優れた導線 | 確認済み |

### ヨドバシカメラ
**要約**: EC大手。

| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | 一般対応 | 確認済み |
| FV訴求 | 同等 | 標準 | 推定 |
| CTA明確性 | 強 | 明確 | 確認済み |
| 信頼構築 | 強 | 大手実績 | 確認済み |
| 価格・オファー | 同等 | 中位 | 確認済み |
| 購買導線 | 強 | ポイント連携 | 確認済み |

## 5. 実行プラン
### 最優先3施策
1. 施策A
`

const PROMOTED_HEADINGS_FIXTURE = `## 4. ブランド別評価

## カメラの大林
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | A | 確認済み |
| FV訴求 | 弱 | B | 推定 |

## キタムラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | C | 確認済み |
| FV訴求 | 強 | D | 確認済み |

## ヨドバシ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | E | 推定 |
| FV訴求 | 同等 | F | 確認済み |

## 実行プラン
### 最優先3施策
1. 施策A
`

describe('findBrandEvalSectionBody', () => {
  it('returns empty string for non-strings or missing section', () => {
    expect(findBrandEvalSectionBody(null)).toBe('')
    expect(findBrandEvalSectionBody('no brand eval here')).toBe('')
  })

  it('stops at the next known major section (実行プラン)', () => {
    const body = findBrandEvalSectionBody(THREE_BRAND_FIXTURE)
    expect(body).toContain('カメラの大林')
    expect(body).toContain('キタムラ')
    expect(body).toContain('ヨドバシカメラ')
    expect(body).not.toContain('## 5. 実行プラン')
  })

  it('does not cut early when brand headings are promoted to ## level', () => {
    const body = findBrandEvalSectionBody(PROMOTED_HEADINGS_FIXTURE)
    expect(body).toContain('カメラの大林')
    expect(body).toContain('キタムラ')
    expect(body).toContain('ヨドバシ')
    expect(body).not.toContain('## 実行プラン')
  })
})

describe('findBrandSectionBodies', () => {
  it('extracts all 3 brands from standard ### structure', () => {
    const chunks = findBrandSectionBodies(THREE_BRAND_FIXTURE)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].title).toContain('カメラの大林')
    expect(chunks[1].title).toBe('キタムラ')
    expect(chunks[2].title).toBe('ヨドバシカメラ')
  })

  it('extracts all 3 brands even when headings are promoted to ##', () => {
    const chunks = findBrandSectionBodies(PROMOTED_HEADINGS_FIXTURE)
    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.title)).toEqual(['カメラの大林', 'キタムラ', 'ヨドバシ'])
  })

  it('filters out non-brand trailing headings like "まとめ"', () => {
    const md = `## 4. ブランド別評価

### ブランドA
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | x | 確認済み |

### まとめ
総合的には...
`
    const chunks = findBrandSectionBodies(md)
    expect(chunks.map((c) => c.title)).toEqual(['ブランドA'])
  })
})

describe('parseBrandVerdicts', () => {
  it('parses verdicts with all 6 axes', () => {
    const chunks = findBrandSectionBodies(THREE_BRAND_FIXTURE)
    const kitamura = chunks.find((c) => c.title === 'キタムラ')
    const verdicts = parseBrandVerdicts(kitamura.body)
    expect(verdicts).not.toBeNull()
    for (const axis of AXIS_KEYS) {
      expect(verdicts[axis]).toBeDefined()
      expect(verdicts[axis].verdict).toBeTruthy()
    }
    expect(verdicts['検索意図一致'].verdict).toBe('同等')
    expect(verdicts['FV訴求'].verdict).toBe('強')
  })

  it('returns null when the table is too short', () => {
    expect(parseBrandVerdicts('no table here')).toBeNull()
    expect(parseBrandVerdicts('| only one line |')).toBeNull()
  })

  it('returns null when required columns are missing', () => {
    const body = `| col1 | col2 |
| --- | --- |
| a | b |
`
    expect(parseBrandVerdicts(body)).toBeNull()
  })

  it('handles "評価保留" verdicts', () => {
    const body = `| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 評価保留 | データ不足 | 評価保留 |
`
    const verdicts = parseBrandVerdicts(body)
    expect(verdicts['検索意図一致'].verdict).toBe('評価保留')
  })
})
