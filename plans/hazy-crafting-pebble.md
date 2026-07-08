# Codex 投入用プロンプト

## Context

Creative Review のバナー画像アップロードが本番環境でタイムアウトする問題を修正したい。
直前のコミット `33aa607` で `uploadCreativeAsset()` から `direct: true` を削除したが、状況が悪化した。

## Codex プロンプト（以下をコピーして投入）

---

### タスク

`src/api/marketLens.js` の Creative Review アップロード（`uploadCreativeAsset`）が本番 Vercel 環境でタイムアウトする問題を修正せよ。

### 現状の構成

```
Insight Studio (Vite SPA on Vercel)
  vercel.json rewrites:
    /api/ml/:path*  →  https://market-lens-ai.onrender.com/api/:path*

src/api/marketLens.js の定数:
  VITE_MARKET_LENS_API_ORIGIN  → Vercel env に未設定 → '' (空文字)
  BASE                         → '/api/ml'  (常にプロキシ経由)
  DIRECT_BACKEND_BASE          → 'https://market-lens-ai.onrender.com/api'
```

### 問題の経緯

1. **初期状態:** `uploadCreativeAsset()` に `direct: true` が付いていた → `ensureDirectBackend()` のヘルスチェック (最大15秒×3回リトライ) が走り、37KB の画像アップロードに過剰な遅延が発生
2. **コミット 33aa607 の修正:** `direct: true` を削除 → リクエストが `/api/ml/assets` (Vercel proxy) 経由になった → **タイムアウトで完全に動かなくなった**
3. **根本原因の仮説:**
   - Vercel rewrite proxy 経由の multipart/form-data アップロードが正しく転送されていない可能性
   - Render バックエンド (free tier) のコールドスタートで 30秒タイムアウト内に応答できない可能性
   - Render 側 CORS_ORIGINS に `https://insight-studio-chi.vercel.app` が未追加（直前に手動追加を依頼済みだが未実施の可能性）

### 関連コード

**`uploadCreativeAsset` (L598-606):**
```js
export function uploadCreativeAsset(file) {
  const formData = new FormData()
  formData.append('file', file)
  return requestRaw('/assets', {
    method: 'POST',
    body: formData,
    timeout: 30000,
  })
}
```

**`requestRaw` (L448-493):** `direct` フラグなしの場合 `BASE` (`/api/ml`) を使う。AbortError で「タイムアウト」エラーを投げる。

**`ensureDirectBackend` (L363-384):** ヘルスチェック → 成功なら `true`、失敗なら `false` を返す。リトライ間隔 [0, 5000, 10000]ms。

**`requestJson` の direct フォールバック (L389-394):**
```js
if (direct && !SHOULD_FORCE_PROXY) {
  const ready = await ensureDirectBackend()
  baseUrl = ready ? DIRECT_BACKEND_BASE : BASE  // フォールバック済み
}
```

**`vercel.json` の rewrite:**
```json
{ "source": "/api/ml/:path*", "destination": "https://market-lens-ai.onrender.com/api/:path*" }
```

**Vercel env vars:** `VITE_MARKET_LENS_API_ORIGIN` は未設定。

**Render CORS_ORIGINS (現在):** `http://localhost:3001,https://market-lens-ai-staging.vercel.app` ← `insight-studio-chi.vercel.app` が未追加

### 制約

- Vercel Hobby プランの rewrite proxy タイムアウトは約 30〜60 秒
- Render free tier はコールドスタートに 30〜60 秒かかることがある
- `ensureDirectBackend()` のヘルスチェックは最大 45 秒かかる（不要な遅延は避けたい）
- CORS_ORIGINS の追加は Render ダッシュボードでの手動作業（コード側で解決できない）

### 求める修正方針

1. **アップロードが確実に動く方式を選定せよ。** 以下の選択肢から最適なものを選ぶか、より良い案を提案せよ:
   - **案A:** `direct: true` を復活させつつ、ヘルスチェック遅延を最小化する（例: ヘルスチェック済みならスキップ、タイムアウトを短縮）
   - **案B:** `VITE_MARKET_LENS_API_ORIGIN` を Vercel env に設定して `BASE` を直接 Render URL にする（proxy を完全にバイパス）
   - **案C:** proxy 経由のまま、タイムアウトを延長し、Render コールドスタート対策を入れる
   - **案D:** アップロード専用の軽量ヘルスチェック（短いタイムアウト）を実装する

2. **`requestJson` と `requestRaw` の direct フォールバック** (コミット 33aa607 で追加) は正しいのでそのまま維持せよ。

3. **変更は `src/api/marketLens.js` のみ**に留めよ。`vercel.json` やバックエンドの変更は不要。

4. 修正後 `npm run build` が成功することを確認せよ。

---

## 補足（Codex に渡す必要はないがメモ）

- Fix D (CORS追加) はRenderダッシュボードで手動対応が必要
- `VITE_MARKET_LENS_API_ORIGIN` を Vercel env に追加する案は、CORSが通らない限り direct リクエストが全部失敗するので、CORS追加が前提条件
- 最もシンプルな解決策は「CORS追加 + direct: true 復活 + ヘルスチェック済みならスキップ（既に実装済み）」の組み合わせかもしれない
