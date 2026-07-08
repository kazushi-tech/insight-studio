# AI考察エンジン 品質改善 & UI拡張 プラン

## Context

ユーザーが広告運用プロフェッショナルの視点からAI考察エンジンの品質レビューを依頼。スクリーンショット分析の結果、以下の課題を特定：

- **考察が表面的**: データの再説明に留まり、アクション可能な洞察が不足
- **UIが狭い**: AI回答エリアが `max-w-3xl` (768px) で、表・比較レイアウトに不向き
- **クイックプロンプトが汎用的**: 「リスクを要約して」等、具体性に欠ける
- **フォローアップ時のコンテキスト劣化**: `extractMarkdownSummary` が構造を破壊

**スコープ**: フロントエンド（insight-studio リポ）のみ。バックエンドのシステムプロンプトは ads-insights リポにあるため今回は対象外。

---

## Phase 1: UI幅拡張（即時効果・低リスク）

### 変更ファイル: `src/pages/AiExplorer.jsx`

| 行 | 現在 | 変更後 | 意図 |
|----|------|--------|------|
| L581 | `max-w-3xl` | `max-w-5xl` | AI回答を768px→1024pxに拡張、表・比較が読みやすく |
| L588 | `max-w-2xl` | `max-w-3xl` | ユーザーメッセージも少し広く |
| L562 | `px-10` | `px-6` | スクロール領域の余白を詰めてコンテンツ幅を確保 |
| L416 | `px-10` | `px-6` | ヘッダー領域も合わせる |
| L615 | `px-10` | `px-6` | 入力領域も合わせる |

---

## Phase 2: クイックプロンプト改善（低リスク・意味的改善）

### 変更ファイル: `src/pages/AiExplorer.jsx` L36-40

**現在:**
```javascript
const QUICK_PROMPTS = [
  { icon: 'warning', label: 'リスクを要約して', color: 'text-red-500' },
  { icon: 'lightbulb', label: 'ROI改善のアイデア', color: 'text-emerald-500' },
  { icon: 'compare_arrows', label: '先月と比較して', color: 'text-purple-500' },
]
```

**変更後:** 広告運用特化の具体的な質問に変更
```javascript
const QUICK_PROMPTS = [
  { icon: 'warning', label: 'コンバージョン流出ポイントを特定して', color: 'text-red-500' },
  { icon: 'lightbulb', label: '最も効果的な流入チャネルとその理由', color: 'text-emerald-500' },
  { icon: 'compare_arrows', label: '期間比較で一番変化が大きい指標は？', color: 'text-purple-500' },
]
```

---

## Phase 3: プロンプトエンリッチメント（中リスク・品質改善の核）

### 3A: 分析指示ビルダー追加

### 変更ファイル: `src/utils/adsReports.js`

`buildAiChartContext` (L158) の後に新規関数 `buildAnalysisInstructions` を追加：

```javascript
export function buildAnalysisInstructions(queryTypes = [], periods = []) {
  const typeLabels = {
    pv_analysis: 'ページビュー分析',
    traffic_analysis: 'トラフィック分析',
    cv_analysis: 'コンバージョン分析',
    device_analysis: 'デバイス分析',
    user_analysis: 'ユーザー行動分析',
  }
  const types = queryTypes.map(t => typeLabels[t] || t).join('、')
  const periodInfo = periods.length > 1
    ? `複数期間（${periods.join('、')}）の比較データ`
    : periods[0] ? `期間: ${periods[0]}` : ''

  return [
    `【分析フレームワーク】`,
    `以下のデータを含む: ${types || '広告パフォーマンスデータ'}。${periodInfo}`,
    `評価レンズ:`,
    `- ビジネス影響: 指標が収益・リードに与える影響`,
    `- ファネル品質: PV→セッション→エンゲージメント→CVの転換率`,
    `- チャネル効率: 有料vsオーガニックのROI`,
    `- ユーザー行動: デバイス・時間帯パターン`,
    `出力要件: 具体的な数値、変化率、優先順位付きアクションを含める。表面的な再説明は避ける。`,
  ].join('\n')
}
```

### 3B: handleSend の enrichedPrompt 構築改善

### 変更ファイル: `src/pages/AiExplorer.jsx` L241-244

**現在:**
```javascript
const enrichedPrompt =
  contextMode === 'ads-with-ml' && mlContextSummary
    ? `${prompt}\n\n[補助コンテキスト: Market Lens]\n${mlContextSummary}`
    : prompt
```

**変更後:**
```javascript
const analysisInstructions = buildAnalysisInstructions(
  setupState?.queryTypes ?? [],
  setupState?.periods ?? [],
)
const enrichedPrompt = [
  analysisInstructions,
  contextMode === 'ads-with-ml' && mlContextSummary
    ? `[補助コンテキスト: Market Lens]\n${mlContextSummary}`
    : '',
  `---\n${prompt}`,
].filter(Boolean).join('\n\n')
```

### 3C: 初回質問の temperature 調整

### 変更ファイル: `src/pages/AiExplorer.jsx` L255

`temperature: 0.7` → `temperature: messages.length === 0 ? 0.5 : 0.7`
（初回は分析的・精密に、フォローアップはより会話的に）

---

## Phase 4: コンテキスト改善

### 4A: extractMarkdownSummary の改善

### 変更ファイル: `src/utils/adsReports.js` L254-266

**現在:** 見出し・表・リストを除外し、20文字以上の最初の行を返すだけ（構造情報が全て失われる）

**改善:** 全見出しとその直下のデータ行を保持し、要点パックの構造をフォローアップでも維持

```javascript
export function extractMarkdownSummary(markdown) {
  if (typeof markdown !== 'string') return null
  const lines = markdown.split(/\r?\n/)
  const summaryLines = []
  let lastWasHeading = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,3}\s/.test(trimmed)) {
      summaryLines.push(trimmed)
      lastWasHeading = true
    } else if (lastWasHeading && trimmed.length > 0) {
      summaryLines.push(trimmed)
      lastWasHeading = false
    }
  }
  return summaryLines.join('\n') || null
}
```

### 4B: 会話履歴の切り詰め緩和

### 変更ファイル: `src/pages/AiExplorer.jsx` L64

`message.text.slice(0, 500)` → `message.text.slice(0, 800)`
（AIの分析回答が重要なコンテキストを含むため、切り詰めを緩和）

---

## Phase 5: 応答品質フィードバック改善

### 変更ファイル: `src/pages/AiExplorer.jsx` L317-321

**現在:** 文字数 < 100 のみチェック

**改善:** より高度な品質評価ロジックに置き換え
- 表（`|`パターン）が含まれているか
- 太字の数値（`**...%**`）が含まれているか
- 具体的な数値参照が含まれているか
- 低品質の場合、再質問のヒントを具体的に提示

---

## 変更ファイル一覧

| ファイル | Phase | 変更内容 |
|----------|-------|----------|
| `src/pages/AiExplorer.jsx` | 1-5 | UI幅、クイックプロンプト、エンリッチメント、温度、履歴、品質FB |
| `src/utils/adsReports.js` | 3-4 | `buildAnalysisInstructions` 追加、`extractMarkdownSummary` 改善 |

**変更なし（動作確認のみ）:**
- `src/components/MarkdownRenderer.jsx` — テーブル幅が `max-w-full` + 列幅制約ありなので広げても問題なし

---

## Verification

1. `npm run dev` で開発サーバー起動
2. `/ads/ai` ページを開き、セットアップ完了状態にする
3. Quick Analysis の3ボタンが新しいテキストで表示されることを確認
4. 任意のクイックプロンプトをクリック → AI回答が `max-w-5xl` で広く表示されることを確認
5. 表を含む回答で、表が読みやすく表示されることを確認
6. フォローアップ質問 → コンテキストが維持されていることを確認
7. `npm run build` でビルドエラーがないことを確認
