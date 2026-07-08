# Fix: 529 Overloaded 自動リトライ追加

## Context

Claude API が一時的に過負荷 (529 Overloaded) のとき、バックエンド (Market Lens) はこれを 500/502 でラップしてフロントエンドに返す。
現在のフロントエンドのリトライ条件では `529` や `overloaded` を検出できないため、
リトライ可能な一時エラーなのに即座にユーザーへエラー表示してしまう。

## 変更箇所

### 1. `src/api/marketLens.js` — `classifyError()`
529 / overloaded_error を retryable として分類する。

```js
// Claude API overloaded (529)
if (status === 529 || msg.includes('overloaded')) {
  return { category: 'overloaded', label: 'AI一時過負荷', guidance: 'AIサービスが一時的に混み合っています。数分後に再試行してください。', retryable: true }
}
```

### 2. `src/api/marketLens.js` — `isDiscoveryRetryableError()`
500 で `overloaded` または `529` を含む場合にリトライする条件を追加。

### 3. `src/api/marketLens.js` — `requestScanWithRetry()`
500 のリトライ条件に `overloaded` / `529` を追加。

```js
|| (status === 500 && /unicodeerror|internal server error|overloaded|529/i.test(error.message))
```

### 4. `src/api/marketLens.js` — `isReviewRetryableError()`
同様に overloaded/529 をリトライ対象に追加。

### 5. `src/api/marketLens.js` — `buildErrorMessage()`
529 用のユーザーフレンドリーなメッセージを追加。

## 影響範囲

- ファイル: `src/api/marketLens.js` のみ
- 各リトライ関数 (scan, discovery, review) すべてに適用

## 検証方法

1. `npm run dev` でローカル起動
2. Compare画面でURLを入力 → 分析開始
3. 529エラーが返ってきた場合、自動リトライされることを確認（コンソールログで確認）
4. リトライ上限後も失敗する場合、ユーザーフレンドリーな「AI一時過負荷」メッセージが表示されることを確認
