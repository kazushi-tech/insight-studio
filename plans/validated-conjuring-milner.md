# Fix: Creative Review Error & Step 3 詳細比較 Readability

## Context
Creative Reviewで"LLM output parse failed: JSON parse error"が発生。DiscoveryのStep 3: 詳細比較テーブルが見づらい。両方を修正する。

## Changes

### 1. Creative Review: 自動リトライ追加 & エラーメッセージ改善
**File:** `src/pages/CreativeReview.jsx`
- `handleReview`で"LLM output parse failed"エラー時に1回自動リトライを追加
- バックエンドが空レスポンスを返した場合のユーザーフレンドリーなメッセージ表示

**File:** `src/api/marketLens.js`
- `reviewBanner` / `reviewAdLp` に自動リトライロジックを追加（`requestDiscoveryAnalyzeWithRetry` パターンを流用）
- "LLM output parse"エラーを`classifyError`で`upstream`として分類（既にretryable）

### 2. Step 3: 詳細比較 テーブル表示改善
**File:** `src/components/MarkdownRenderer.jsx`
- Discovery variantのテーブルセル幅を改善: `min-w`の指定を見直し
- 比較系テーブルの`td`に十分なパディングと可読性を確保
- テーブルヘッダーの視認性向上（背景色・フォントサイズ調整）

## Verification
1. `npm run dev`で開発サーバー起動
2. Chrome DevTools（ゲストモード）で確認:
   - Creative Review: 画像アップロード→レビュー実行→エラー時の自動リトライ動作確認
   - Discovery: Step 3: 詳細比較のテーブル可読性確認
3. `npm run build`でビルド成功確認
