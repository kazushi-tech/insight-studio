# Stitch2 UI/UX デザイン反映計画

## Context
ユーザーがstitch2で作成したオリジナルUI/UXデザインに現在の実装を寄せる。
主要な要望:
1. **CreativeReview** にダイヤモンド型 Performance Radar を追加
2. **Compare (LP比較)** のスコアカード・レポートレイアウトをstitch2に合わせる
3. **Discovery (競合発見)** のカードデザインを微調整
4. **AiExplorer (広告考察)** は軽微なスタイル調整のみ

現在の機能・データフローは一切崩さず、見た目のみをstitch2デザインに寄せる。

---

## A. CreativeReview — Performance Radar 追加

### 対象ファイル
- `src/components/PerformanceRadar.jsx` (新規作成)
- `src/pages/CreativeReview.jsx` (import追加 + 挿入)

### 実装内容

**1. `PerformanceRadar.jsx` コンポーネント (~130行)**

Props: `{ rubricScores }` — `review.rubric_scores` 配列

データマッピング — 21のルーブリックスコアを4軸にグループ化:
```
構成 (Composition): visual_flow, information_balance, information_density, first_view_clarity
デザイン (Design): visual_impact, brand_consistency, competitive_edge
CTA: cta_effectiveness, cta_clarity, cta_placement, offer_clarity
信頼性 (Trustworthiness): credibility, trust_elements, drop_off_risk
```

各軸 = グループ内平均 (0-5)、Total Score = 全ルーブリック平均 × 20 (0-100スケール)

UIレイアウト (stitch2/stitch (4)/code.html L206-245準拠):
- ヘッダー: "Performance Radar" + "4-axis comparative scoring" + Total Scoreバッジ (bg-primary-container)
- ダイヤモンド可視化 (w-64 h-64):
  - 3層の同心ダイヤモンドグリッド (rotate-45 の正方形3つ、border-outline-variant/30)
  - データ形状: `clip-path: polygon(50% topY%, rightX% 50%, 50% bottomY%, leftX% 50%)` with `bg-[#D4A843]/20 border-2 border-[#D4A843]`
  - 4方向のラベル (absolute positioned)
- 下部: 2カラムメトリクスカード（Conversion Rate Est. / Avg. Time on Page — rubricデータにない場合はダッシュ表示）

純粋CSS実装 (Chart.js不使用)。

**2. CreativeReview.jsx の変更**
- import追加: `import PerformanceRadar from '../components/PerformanceRadar'`
- Step 3の`<ReviewResultDisplay>`直前 (L720付近) に挿入:
  ```jsx
  {reviewResult?.rubric_scores && <PerformanceRadar rubricScores={reviewResult.rubric_scores} />}
  ```

---

## B. Compare (LP比較) — レイアウト改善

### 対象ファイル
- `src/pages/Compare.jsx`

### 実装内容 (stitch2/stitch (1) 準拠)

**1. スコアカードのスタイル改善**
- 現在: col-span-4のグラデーションパネルにスコア表示
- 変更: stitch2と同じゴールドグラデーション (`from-secondary to-secondary-fixed-dim`) を維持しつつ:
  - "OVERALL STRATEGY SCORE" ラベルを`uppercase tracking-[0.2em] opacity-80` に
  - メトリクス行をボーダー区切り (`border-b border-white/20 pb-2`) に統一
  - 下部に分析サマリーテキスト追加

**2. レポートセクションの構造化**
- 現在: MarkdownRendererで一括表示
- 変更: stitch2スタイルのセクション分け:
  - 各セクションにアイコン + 太字見出し (e.g., メッセージング戦略、視覚的階層、改善の提案)
  - `pl-9`インデント + `text-on-surface-variant text-sm leading-relaxed` 本文
  - Strength/Opportunity ミニカード (grid-cols-2, border-l-4)
  - レポートがMarkdownで来るため、セクション分割はMarkdownRenderer側ではなく、既存のMarkdownRendererをそのまま使い、**外枠のカードスタイル**だけstitch2に寄せる

**3. LP プレビュー表示の改善**
- ラベル追加: "INSIGHT STUDIO (CONTROL)" / "COMPETITOR ALPHA" + "Desktop View"
- 画像/iframeに `rounded-[16px] overflow-hidden` + hover `scale-[1.01]` エフェクト

---

## C. Discovery (競合発見) — カードデザイン微調整

### 対象ファイル
- `src/pages/Discovery.jsx`

### 実装内容 (stitch2/stitch (2) 準拠)

**1. LP カードのスタイル調整**
- スコアバッジ: 現在のスタイルを維持しつつ、stitch2の `SCORE` ラベル + 大きなスコア数字に寄せる
- カードの角丸を`rounded-[16px]`に統一
- ホバーエフェクト: `transition-transform hover:scale-[1.01]`
- "分析する" ボタンのスタイル: stitch2のborder-t区切り + 中央揃えスタイルに

**2. ヘッダー部分の微調整**
- "Discovery Hub" タイトルのフォントウェイトを`font-extrabold`に
- サブタイトルの文字色・サイズ調整

---

## D. AiExplorer (広告考察) — 軽微なスタイル調整

### 対象ファイル
- `src/pages/AiExplorer.jsx`

### 実装内容 (stitch2/stitch (8) 準拠、軽微のみ)

**1. Quick Analysisボタンのスタイル**
- 現在のピル型ボタンを維持しつつ、アイコンカラーとフォントウェイトをstitch2に寄せる
- ボタン背景を `bg-white border border-slate-200 rounded-xl` に統一

**2. チャットバブルのスタイル微調整**
- アシスタントメッセージカード: `rounded-[16px]` に統一
- ユーザーメッセージ: 角丸とパディング調整

---

## 実装順序
1. **A. PerformanceRadar** (新規コンポーネント + CreativeReview挿入) — 最優先
2. **B. Compare レイアウト改善** — スコアカード + レポート外枠
3. **C. Discovery カード微調整**
4. **D. AiExplorer 軽微調整**

## 検証方法
1. `npm run build` — プロダクションビルド確認
2. `npm run dev` — 各ページの目視確認:
   - CreativeReview: レビュー実行後にPerformance Radarが表示されること
   - Compare: 分析結果のスコアカード・レポート表示
   - Discovery: LP カードのスタイル
   - AiExplorer: Quick Analysisボタン・チャットバブル
3. ルーブリックスコアが空/部分的な場合のフォールバック確認
