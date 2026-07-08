# 追加修正プラン: direct モードの堅牢化（エラー撲滅）

## Context

前セッションで Vercel 60秒制限回避のため direct モードを実装・デプロイ済み。
レビューの結果、以下の3つの致命的な穴が判明。これを塞いで「絶対にエラーが出ない」状態にする。

## 発見された問題

### CRITICAL 1: CORS — ads-insights に Insight Studio ドメインが未登録

**現状:** `tmp_ads_insights_repo/web/app/backend_api.py:1215-1233`
```python
# 許可オリジン（本番）
"https://ads-insights-eight.vercel.app"   # ← 旧ドメインのみ
```

Insight Studio（`https://insight-studio-chi.vercel.app` 等）からの direct リクエストは **CORS で弾かれる**。
`CORS_ALLOWED_ORIGINS` 環境変数で追加可能だが、Render に設定されているか不明。

**対比:** market-lens-ai は `https://insight-studio-chi.vercel.app` が登録済み → 問題なし。

### CRITICAL 2: adsInsights.js — direct 失敗時のフォールバックなし

**現状:** `src/api/adsInsights.js:74`
```js
const base = direct ? ADS_DIRECT_BASE : BASE  // 失敗したら即エラー
```

**対比:** `src/api/marketLens.js:363-384` の `ensureDirectBackend()` は:
- ヘルスチェック3回リトライ（0ms → 5s → 10s バックオフ）
- `SHOULD_FORCE_PROXY`（ローカル開発時はプロキシ強制）
- CORS/ネットワークエラー時にプロキシへフォールバック

adsInsights.js にはこの仕組みが一切ない。

### CRITICAL 3: AiExplorer.jsx — リトライ中のクリーンアップなし

**現状:** `src/pages/AiExplorer.jsx:228-251`
- `handleSend` はイベントハンドラ（useEffect ではない）
- リトライの `setTimeout` がキャンセルされない
- ページ遷移中に孤児リクエスト + アンマウント後の `setState`

**既存パターン:**
- 同ファイル L121-149: `cancelled` フラグの useEffect パターン
- Discovery.jsx L213-220: `pollStoppedRef` + `clearTimeout` の ref パターン

---

## 修正計画

### Fix 1: Render 環境変数に Insight Studio ドメインを追加

**対象:** Render ダッシュボード → ads-insights → Environment
**作業:** `CORS_ALLOWED_ORIGINS` に Insight Studio の Vercel ドメインを追加

```
CORS_ALLOWED_ORIGINS=https://insight-studio-chi.vercel.app
```

> **注意:** 正確なドメインは Vercel ダッシュボードで確認すること。カスタムドメインがあればそれも追加。

**検証:** ブラウザ DevTools Network タブで direct リクエストの CORS preflight (OPTIONS) が 200 を返すこと。

### Fix 2: adsInsights.js に ensureDirectBackend + フォールバック追加

**対象:** `src/api/adsInsights.js`

**追加するコード:**

```js
// --- 追加: direct バックエンド準備 ---
const isLocalOrigin = () => {
  try {
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch { return false }
}
const SHOULD_FORCE_PROXY = isLocalOrigin()
let _directReady = false

async function ensureDirectAdsBackend() {
  if (_directReady) return true
  const RETRY_DELAYS = [0, 5000, 10000]
  for (const delay of RETRY_DELAYS) {
    try {
      if (delay) await new Promise(r => setTimeout(r, delay))
      await fetch(`${ADS_DIRECT_BASE}/health`, {
        signal: AbortSignal.timeout(30000),
      })
      _directReady = true
      return true
    } catch { /* retry */ }
  }
  return false
}
```

**request() 関数の修正（L74 付近）:**

```js
// Before:
const base = direct ? ADS_DIRECT_BASE : BASE

// After:
let base = BASE
if (direct && !SHOULD_FORCE_PROXY) {
  const ready = await ensureDirectAdsBackend()
  base = ready ? ADS_DIRECT_BASE : BASE  // フォールバック
}
```

**エラー時のリセット（request() の catch 内に追加）:**

```js
// CORS やネットワークエラーで direct フラグをリセット
if (direct && err.name !== 'AbortError') {
  _directReady = false
}
```

**参照:** `src/api/marketLens.js:363-384` の `ensureDirectBackend()` パターンを踏襲。

### Fix 3: AiExplorer.jsx リトライに ref ベースのキャンセル追加

**対象:** `src/pages/AiExplorer.jsx`

**追加する ref（コンポーネントトップ付近）:**

```jsx
const abortRef = useRef(null)
```

**useEffect でアンマウント時クリーンアップ:**

```jsx
useEffect(() => {
  return () => {
    if (abortRef.current) abortRef.current.abort()
  }
}, [])
```

**リトライループの修正（L228-251 付近）:**

```jsx
const controller = new AbortController()
abortRef.current = controller

const MAX_RETRIES = 2
const RETRY_DELAYS = [1500, 4000]
let data = null

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  if (controller.signal.aborted) break  // ← ガード追加
  try {
    if (attempt > 0) {
      setStatus(`リトライ中 (${attempt}/${MAX_RETRIES})...`)
      await new Promise((r, reject) => {
        const id = setTimeout(r, RETRY_DELAYS[attempt - 1])
        controller.signal.addEventListener('abort', () => {
          clearTimeout(id)
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }
    data = await neonGenerate(neonPayload, analysisKey)
    break
  } catch (err) {
    if (err.name === 'AbortError') return  // ← 静かに終了
    // ... 既存のリトライ判定
  }
}
```

---

## 実行順序

1. **Fix 1（CORS）を最優先** — これが通らないと direct モードが全滅
   - Render ダッシュボードで `CORS_ALLOWED_ORIGINS` を設定
   - バックエンド再起動を待つ
2. **Fix 2（フォールバック）** — CORS が通っても通らなくても安全になる
3. **Fix 3（クリーンアップ）** — リトライの安全性確保
4. `npm run build` で確認
5. コミット & デプロイ

## 検証チェックリスト

- [ ] Render に `CORS_ALLOWED_ORIGINS` 設定完了
- [ ] DevTools Network: direct リクエストの OPTIONS preflight が 200
- [ ] DevTools Network: neonGenerate が `ads-insights-9q5s.onrender.com` に直接到達
- [ ] AI考察: 正常に生成完了（60秒超でもタイムアウトしない）
- [ ] AI考察: バックエンドダウン時に Vercel proxy にフォールバック
- [ ] AI考察: リトライ中にページ遷移 → コンソールに warning なし
- [ ] ローカル開発 (`npm run dev`): SHOULD_FORCE_PROXY で proxy 経由になる
- [ ] `npm run build` 成功
