/**
 * Phase 5B fixture — envelope: null, reportMd-only. Exercises the MD fallback
 * path end-to-end (brandEvalParser.js + marketRange MD parser + priority
 * action parser). Carries 3 brands so the Phase B "only first brand rendered"
 * regression (PR #39) stays pinned.
 *
 * NEXT_MAJOR_SECTION_RE allow-list lives in src/utils/brandEvalParser.js.
 */

const reportMd = `# 最小レポート (MD-only)

## 1. エグゼクティブサマリー
envelope が無くても全 v2 コンポーネントが描画できることを確認するサンプル。

## 2. 最優先施策
1. 検索広告強化: 指名系ワードの完全一致比率を上げる
2. CTA統合: FV 内 CTA を 1 つに絞り、明瞭度を優先
3. LP 信頼導線: 事例 → 比較 → 問合せの順に導線を再編

## 3. 市場推定データ
**信頼度**: 低

| 指標 | レンジ | 単位 |
| --- | --- | --- |
| 市場規模 | 50000〜90000 | 百万円 |
| 検索ボリューム | 3000〜6000 | 回/月 |

## 4. ブランド別評価

### 社Ａ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | 指名ワード完全一致 | 確認済み |
| FV訴求 | 同等 | 標準構成 | 推定 |
| CTA明確性 | 同等 | 単一 CTA | 確認済み |
| 信頼構築 | 弱 | 事例なし | 確認済み |
| 価格・オファー | 同等 | 定価 | 確認済み |
| 購買導線 | 同等 | カート | 確認済み |

### 社Ｂ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | 準指名対応 | 推定 |
| FV訴求 | 強 | 訴求明瞭 | 確認済み |
| CTA明確性 | 強 | 固定 CTA | 確認済み |
| 信頼構築 | 同等 | 実績記載 | 確認済み |
| 価格・オファー | 強 | オファー提示 | 確認済み |
| 購買導線 | 強 | チャット導線 | 確認済み |

### 社Ｃ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | 商材訴求 | 確認済み |
| FV訴求 | 弱 | 動画主体 | 推定 |
| CTA明確性 | 弱 | 複数 CTA | 確認済み |
| 信頼構築 | 同等 | レビュー記載 | 推定 |
| 価格・オファー | 弱 | 非表示 | 確認済み |
| 購買導線 | 弱 | 来店前提 | 確認済み |

## 5. 実行プラン
envelope が揃うまでの暫定運用として、MD fallback だけでも主要セクションが描画される。
`

export default {
  envelope: null,
  reportMd,
}
