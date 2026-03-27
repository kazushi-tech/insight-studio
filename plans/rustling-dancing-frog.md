# EssentialPack (/ads/pack) レポート表示修復計画

## Context

`/ads/pack`ページ（EssentialPack.jsx）でbackendからのデータが全く表示されない。
黄色い警告「backendから構造化セクションも本文も返っていません」が出ている。

**根本原因**: EssentialPackが`generateInsights()`（`POST /api/generate_insights`）を呼んでいるが、
このエンドポイントは `{ok, text}` という単純な形式で返す。一方、EssentialPackは
`sections[]`に`metrics[]`/`devices[]`/`table[]`という**backendが一切返さない架空の構造**を期待している。

**リファレンスアプリの正しいパターン**:
- `bqGenerateBatch` を期間ごとに呼ぶ → `{ok, markdownReport, chartData, summary, point_pack}` を取得
- `markdownReport` をMarkdownとしてレンダリング
- h1見出しでセクション分割 → アコーディオン表示

## 方針

1. **Wizardのレスポンスデータを保持** — AdsSetupContextにin-memory保存（localStorageには入れない）
2. **EssentialPackを書き直し** — 架空の構造セクションを廃止、Markdownベースのレポート表示に切替
3. **リフレッシュ対応** — reportDataが無い場合はbqGenerateBatch再取得
4. **軽量Markdownレンダラー** — 依存ライブラリ追加なし、自前で実装

## 変更ファイル

### 1. `src/contexts/AdsSetupContext.jsx`
- `reportData` state追加（useStateのみ、localStorageには保存しない）
- `completeSetup(metadata, reportData)` — 第2引数でレポートデータ受け取り
- `reportData` と `setReportData` をcontext valueで公開
- `resetSetup` / logout時に `reportData` もクリア

### 2. `src/pages/SetupWizard.jsx`
- L204: `completeSetup(metadata, loadResult)` — 既存のloadResultを渡すだけ（1行変更）

### 3. `src/components/MarkdownRenderer.jsx` (新規)
- 軽量Markdown→JSXパーサー（~100-150行）
- 対応: h1-h3, bold, italic, リスト, テーブル, コードブロック, 段落
- Tailwindクラスでスタイリング

### 4. `src/pages/EssentialPack.jsx` (主要書き直し)
- `generateInsights` → `bqGenerateBatch` import切替
- `SECTION_CONFIG`、`normalizeSections`、`sectionHasStructuredData` 等の架空構造を全削除
- `useAdsSetup()` から `reportData` 読み取り
- reportData無し＋setupState有り → `bqGenerateBatch`を期間ごとに再取得
- `markdownReport` をh1で分割 → 動的セクションナビ構築
- `MarkdownRenderer` でレンダリング
- `summary` をサイドバーのAI INSIGHTカードに表示
- 複数期間 → タブ/ドロップダウンで期間切替、1期間ずつ表示

### 5. `src/utils/adsResponse.js` (軽微)
- `getMarkdownReport(payload)` — `markdownReport`キーを優先検索
- `getPointPack(payload)` — `point_pack`キーを検索

## スコープ外（今回は対応しない）
- **AnalysisGraphs.jsx** — `loadData`エンドポイント使用、別問題
- **AiExplorer.jsx** — `generateInsights`のチャット利用は正当、変更不要
- **Chart.js導入** — chartDataの描画はフォローアップ（Markdown表示が最優先）
- **レポート出力/共有ボタン** — 現状no-opのまま

## 実装順序

```
[並列] AdsSetupContext拡張 + MarkdownRenderer作成
  ↓
SetupWizard 1行修正
  ↓
EssentialPack 書き直し
  ↓
adsResponse.jsヘルパー追加
  ↓
ビルド確認 + 動作検証
```

## 検証方法

1. `npm run build` — ビルドエラーなし
2. dev serverで `/ads/wizard` → セットアップ完了 → `/ads/pack` 遷移
3. markdownReportが表示されること（黄色警告が消えること）
4. ブラウザリフレッシュ → 再取得して表示されること
5. 複数期間選択 → 期間切替で各期間のレポート表示
