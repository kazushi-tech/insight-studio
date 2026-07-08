# 529エラー根本原因 & 分析品質改善プラン

## 529 Overloaded の根本原因

### エラー伝播チェーン
```
Claude API (529) → Market Lens Backend (Python/Render) → Insight Studio Frontend
```

1. **Claude API** が過負荷で HTTP 529 を返す
2. **Backend** は独自の exponential backoff (2s→4s→8s...max 60s) でリトライ
3. リトライ枯渇後、529 を **500 にラップ**（detail に `overloaded` / `529` を含む）
4. **Frontend** は 500 として受け取り、従来はリトライ不可と判定 → 即座にエラー表示

### なぜ今回の修正で解決したか
- `classifyError()` が 529 / `overloaded` を `retryable: true` として新分類
- 3つのリトライ関数すべてで 500+overloaded/529 と direct 529 をリトライ対象に追加
- バックエンドが既にリトライ済みでダメなら、フロント側の短いリトライ (1.5〜5s) でも成功する可能性は低いが、**ユーザーに「一時過負荷」であることを明示**できるようになった点が最大の価値

### 再発防止のポイント
- **バックエンド側で 529 リトライを強化**（market-lens-ai リポ）: 現在の max 60s は十分だが、リトライ回数増加を検討
- **フロント側は即座にユーザーへ通知** → 長時間スピナーで待たせるより良いUX
- 529 は Anthropic 側の一時的事象。定常的に発生するならモデル切り替え（Opus→Sonnet等）で回避可能

---

## Plan A: 529 エラー表示の最終仕上げ（小規模）

### Context
`classifyError()` は `overloaded` カテゴリを返すが、`ERROR_CATEGORY_STYLES` に該当エントリがなく、ジェネリックな赤エラー表示にフォールバックしている。529は「ユーザーのせいではない一時的混雑」なので、より柔らかい色調で表現すべき。

### 変更

#### 1. `src/components/ui.jsx` — ERROR_CATEGORY_STYLES に overloaded 追加

**現在 (line 53-62):**
```js
const ERROR_CATEGORY_STYLES = {
  timeout:       { icon: 'schedule',       bg: 'bg-amber-50',  ... },
  // ... rate_limit まで
}
```

**変更:** `rate_limit` の後に1行追加:
```js
overloaded:    { icon: 'cloud_queue',    bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-800', btnText: 'text-violet-700' },
```

- `cloud_queue` — クラウドサービスの待ち行列を表現
- Violet パレット — 既存カテゴリと被らない色。日本UI慣習で「システム混雑・お待ちください」のトーン

### 検証
1. `npm run build` が通ること
2. ErrorBanner で `category: 'overloaded'` を渡すと violet スタイルで表示されること

---

## Plan B: 分析品質改善ロードマップ

広告運用プロフェッショナル視点でのレビュー結果と改善プラン。

### 現状評価

| 機能 | 強み | 弱み |
|------|------|------|
| Discovery | 多段階パイプライン、OG画像付きカード表示 | スコア分布の全体像なし |
| LP Compare | 5軸スコアリング、要素抽出 | スコアに文脈（業界平均等）なし |
| Creative Review | 44のルーブリック基準、レーダーチャート | 優先度表示なし、エクスポートなし |

### Phase 1: スコア文脈化（高インパクト）

#### 1A. スコア定性ラベル追加

**ファイル:** `src/utils/scoreThresholds.js`, `src/pages/Compare.jsx`

`scoreThresholds.js` に `getScoreLabel(score)` ヘルパーを追加:
- 80-100: "Excellent" (emerald)
- 60-79: "Good" (primary)
- 40-59: "Fair" (amber)
- 0-39: "Needs Work" (rose)

Compare.jsx のスコアヘッダーと5軸グリッドに定性ラベルバッジを追加。

#### 1B. ルーブリックスコア解釈ガイド

**ファイル:** `src/pages/CreativeReview.jsx`

`RubricSection` の上部に折りたたみ可能な「採点ガイド」パネル追加:
- 5: 優秀 / 4: 良好 / 3: 平均 / 2: 要改善 / 1: 問題あり

各ルーブリックカードにスコアに応じたマイクロラベル追加。

### Phase 2: アクションナビリティ向上（中インパクト）

#### 2A. 改善項目の優先度可視化

**ファイル:** `src/pages/CreativeReview.jsx` — `ImprovementsSection`

改善項目に視覚的優先度追加:
- 1-2番目: `border-l-4 border-rose-400` (High)
- 3-4番目: `border-l-4 border-amber-400` (Medium)
- 残り: デフォルト

#### 2B. テストアイデアの構造化カード化

**ファイル:** `src/pages/CreativeReview.jsx` — `TestIdeasSection`

Markdown テーブル → 構造化カードに変換。
「A/Bテスト用にコピー」ボタン追加（`navigator.clipboard.writeText()`）。

#### 2C. レポート概要コピーエクスポート

**ファイル:** `Compare.jsx`, `CreativeReview.jsx`, `Discovery.jsx`

「レポートをコピー」ボタン追加。構造化テキストをクリップボードへ。

### Phase 3: データリッチ化（中インパクト、中規模）

#### 3A. Discovery スコア分布チャート

**ファイル:** `src/pages/Discovery.jsx`

Chart.js（既存依存）で自社スコア vs 競合分布のビジュアライズ。

#### 3B. ルーブリック カテゴリ別ヒートマップ

**ファイル:** `src/pages/CreativeReview.jsx`

`AXIS_GROUPS_BY_TYPE`（PerformanceRadar.jsx に既存）でルーブリックをカテゴリ別にグループ化表示。

#### 3C. 過去実行スコア比較

**ファイル:** `src/contexts/AnalysisRunsContext.jsx`, 各ページ

localStorage に過去10件のスコアを永続化し、差分表示（+5, -3 等）。

### 実装優先順位

| 優先度 | プラン | 工数 | 効果 |
|--------|--------|------|------|
| 即時 | Plan A: 529 UI仕上げ | 5分 | エラー体験改善 |
| Phase 1 | 1A+1B: スコア文脈化 | 1-2h | 分析結果の理解性向上 |
| Phase 2 | 2A+2B+2C: アクション性 | 2-3h | 実務への活用促進 |
| Phase 3 | 3A+3B+3C: データリッチ化 | 4-6h | プロフェッショナルな分析体験 |

### 検証方法
1. 各 Phase 完了後に `npm run build` でビルド確認
2. 各画面でスコア表示・エラー表示の目視確認
3. クリップボード機能はブラウザで実際にコピー＆ペーストして検証
