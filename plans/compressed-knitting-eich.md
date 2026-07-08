# Fix: Creative Review アップロード遅延 & direct モード フォールバック未実装

## Context

Creative Review でバナー画像アップロードが「アップロード中…」のまま長時間止まる。
さらにレビュー実行も「レビュー中…」で 5分以上フリーズする。

**原因 1:** `uploadCreativeAsset()` に不要な `direct: true` が付いている。
アップロード前に `ensureDirectBackend()` のヘルスチェック（最大15秒）が走り、
37KB の画像アップロードに対して過剰な遅延が発生。

**原因 2:** `requestJson()` と `requestRaw()` で `ensureDirectBackend()` の戻り値を無視している。
ヘルスチェックが失敗しても常に `DIRECT_BACKEND_BASE` を使うため、proxy フォールバックが効かない。
adsInsights.js では前セッションで修正済みだが、marketLens.js は未修正。

## 修正計画

### Fix A: uploadCreativeAsset から `direct: true` を削除

**対象:** `src/api/marketLens.js:598-607`

画像アップロードは軽量処理で Vercel 60秒制限内に収まるため direct 不要。

```js
// Before:
return requestRaw('/assets', {
  method: 'POST',
  body: formData,
  direct: true,      // ← 削除
  timeout: 30000,
})

// After:
return requestRaw('/assets', {
  method: 'POST',
  body: formData,
  timeout: 30000,
})
```

### Fix B: requestJson に ensureDirectBackend フォールバック追加

**対象:** `src/api/marketLens.js:386-394`

adsInsights.js の修正パターンに合わせる。

```js
// Before:
if (direct && !SHOULD_FORCE_PROXY) {
  await ensureDirectBackend()
  baseUrl = DIRECT_BACKEND_BASE
}

// After:
if (direct && !SHOULD_FORCE_PROXY) {
  const ready = await ensureDirectBackend()
  baseUrl = ready ? DIRECT_BACKEND_BASE : BASE  // フォールバック
}
```

### Fix C: requestRaw に同じフォールバック追加

**対象:** `src/api/marketLens.js:448-455`

```js
// Before:
if (direct && !SHOULD_FORCE_PROXY) {
  await ensureDirectBackend()
  baseUrl = DIRECT_BACKEND_BASE
}

// After:
if (direct && !SHOULD_FORCE_PROXY) {
  const ready = await ensureDirectBackend()
  baseUrl = ready ? DIRECT_BACKEND_BASE : BASE  // フォールバック
}
```

### Fix D: market-lens-ai CORS に Insight Studio ドメイン追加（手動）

**対象:** Render ダッシュボード → market-lens-ai → Environment

現在の `CORS_ORIGINS` に `https://insight-studio-chi.vercel.app` を追加。

```
CORS_ORIGINS=http://localhost:3001,https://market-lens-ai-staging.vercel.app,https://insight-studio-chi.vercel.app
```

## 検証

1. `npm run build` 成功
2. Creative Review で画像アップロード → 数秒以内に完了
3. バナーレビュー実行 → direct で成功 or proxy フォールバックで完了
4. DevTools Network でリクエスト先を確認
