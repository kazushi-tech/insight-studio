/**
 * Phase 5B fixture — realistic Discovery payload with both envelope and reportMd.
 *
 * Used by `/debug/report-v2?fixture=discovery-sample` to exercise ReportViewV2
 * via the envelope code path (charts, tables, confidence pill all fed from
 * structured data). Shape matches the Pydantic ReportEnvelope v0 schema:
 *   backends/market-lens-ai/web/app/schemas/report_envelope.py
 *
 * Brand names are fictional; axis / verdict vocabulary mirrors the canonical
 * AXIS_KEYS used by src/utils/brandEvalParser.js.
 */

const reportMd = `# 市場観察レポート

## 1. エグゼクティブサマリー
サンプルブランドが国内フルサイズミラーレス市場で価格優位に立つも、オファー訴求の弱さが CVR の上限になっている。

## 2. 最優先施策
1. CTA改修: メインCTAを「今すぐ見積もり」に統一し、FV 直下に固定配置
2. 信頼構築: 導入事例カードを FV 下に3点以上配置し、評判を第一スクリーンで可視化
3. FV訴求強化: 価格とオファーを同一ビューに集約し、離脱率を抑える

## 3. 市場推定データ
**信頼度**: 中

| 指標 | レンジ | 単位 |
| --- | --- | --- |
| 市場規模 | 120000〜180000 | 百万円 |
| 検索ボリューム | 8000〜12000 | 回/月 |
| CPC | 250〜480 | 円 |

## 4. ブランド別評価

### サンプルカメラ
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | 指名ワードが FV に露出 | 確認済み |
| FV訴求 | 同等 | 標準的な構成 | 推定 |
| CTA明確性 | 弱 | 複数 CTA が並列配置 | 確認済み |
| 信頼構築 | 同等 | レビュー掲載あり | 確認済み |
| 価格・オファー | 弱 | クーポン導線なし | 確認済み |
| 購買導線 | 同等 | カート標準 | 確認済み |

### ミラーレス堂
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | 汎用 LP 主体 | 推定 |
| FV訴求 | 強 | 価格とオファーを同居 | 確認済み |
| CTA明確性 | 強 | 単一 CTA 固定 | 確認済み |
| 信頼構築 | 強 | 実績表示が常時露出 | 確認済み |
| 価格・オファー | 強 | 値引と同梱特典を前面 | 確認済み |
| 購買導線 | 強 | チャット相談 → カート | 確認済み |

### フォトスタジオ光
| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 弱 | 商材訴求が主 | 確認済み |
| FV訴求 | 同等 | ブランド動画 | 推定 |
| CTA明確性 | 同等 | メール誘導 | 確認済み |
| 信頼構築 | 同等 | 長文レビュー | 推定 |
| 価格・オファー | 弱 | 定価固定 | 確認済み |
| 購買導線 | 弱 | 来店主導 | 確認済み |

## 5. 実行プラン
FV の情報設計を最優先に調整し、オファー訴求を強化する三段階ロードマップを提示。
`

export default {
  envelope: {
    version: 'v0',
    report_id: 'fixture-discovery-sample',
    kind: 'discovery',
    priority_actions: [
      { title: 'CTA改修', detail: 'メインCTAを「今すぐ見積もり」に統一し、FV 直下に固定配置' },
      { title: '信頼構築', detail: '導入事例カードを FV 下に3点以上配置し、評判を第一スクリーンで可視化' },
      { title: 'FV訴求強化', detail: '価格とオファーを同一ビューに集約し、離脱率を抑える' },
    ],
    market_estimate: {
      confidence: '中',
      ranges: [
        { label: '市場規模', min: 120000, max: 180000, unit: '百万円' },
        { label: '検索ボリューム', min: 8000, max: 12000, unit: '回/月' },
        { label: 'CPC', min: 250, max: 480, unit: '円' },
      ],
    },
    brand_evaluations: [
      {
        brand: 'サンプルカメラ',
        axes: [
          { axis: '検索意図一致', verdict: '強', reason: '指名ワードが FV に露出', evidence: '確認済み' },
          { axis: 'FV訴求', verdict: '同等', reason: '標準的な構成', evidence: '推定' },
          { axis: 'CTA明確性', verdict: '弱', reason: '複数 CTA が並列配置', evidence: '確認済み' },
          { axis: '信頼構築', verdict: '同等', reason: 'レビュー掲載あり', evidence: '確認済み' },
          { axis: '価格・オファー', verdict: '弱', reason: 'クーポン導線なし', evidence: '確認済み' },
          { axis: '購買導線', verdict: '同等', reason: 'カート標準', evidence: '確認済み' },
        ],
      },
      {
        brand: 'ミラーレス堂',
        axes: [
          { axis: '検索意図一致', verdict: '同等', reason: '汎用 LP 主体', evidence: '推定' },
          { axis: 'FV訴求', verdict: '強', reason: '価格とオファーを同居', evidence: '確認済み' },
          { axis: 'CTA明確性', verdict: '強', reason: '単一 CTA 固定', evidence: '確認済み' },
          { axis: '信頼構築', verdict: '強', reason: '実績表示が常時露出', evidence: '確認済み' },
          { axis: '価格・オファー', verdict: '強', reason: '値引と同梱特典を前面', evidence: '確認済み' },
          { axis: '購買導線', verdict: '強', reason: 'チャット相談 → カート', evidence: '確認済み' },
        ],
      },
      {
        brand: 'フォトスタジオ光',
        axes: [
          { axis: '検索意図一致', verdict: '弱', reason: '商材訴求が主', evidence: '確認済み' },
          { axis: 'FV訴求', verdict: '同等', reason: 'ブランド動画', evidence: '推定' },
          { axis: 'CTA明確性', verdict: '同等', reason: 'メール誘導', evidence: '確認済み' },
          { axis: '信頼構築', verdict: '同等', reason: '長文レビュー', evidence: '推定' },
          { axis: '価格・オファー', verdict: '弱', reason: '定価固定', evidence: '確認済み' },
          { axis: '購買導線', verdict: '弱', reason: '来店主導', evidence: '確認済み' },
        ],
      },
    ],
  },
  reportMd,
}
