# Fix: AI考案ページの「Failed to fetch」エラー

## Context

Vercel本番環境でAI考案ページ（AiExplorer）を開くと、すべてのAPIリクエストが「Failed to fetch」で失敗する。Quick Analysis、チャット送信、Market Lens履歴取得の全てでエラーが発生。原因は`neonGenerate()`が`allowProxyFallback: false`を設定しており、CORSでブロックされる直接URLからプロキシにフォールバックできないため。

---

## 修正1: `adsInsights.js` — プロキシフォールバックを有効化

**ファイル:** [adsInsights.js:296](src/api/adsInsights.js#L296)

`neonGenerate()`の`allowProxyFallback: false` → `true`に変更。

Vercel上でのフロー:
1. 直接URL（optimistic）→ CORS遮断 → 即時失敗
2. リトライ（verified）→ バックエンド未Ready → **プロキシにフォールバック**（今回の修正で有効化）
3. プロキシ経由で成功

> `marketLens.js`の`requestScanWithRetry`（これも長時間エンドポイント）は既に`allowProxyFallback: true`を使用しているため、前例あり。

---

## 修正2: `AiExplorer.jsx` — ネットワークエラーをリトライ対象に追加

**ファイル:** [AiExplorer.jsx:262-266](src/pages/AiExplorer.jsx#L262-L266)

```diff
  const retryable =
    err.message?.includes('timeout') ||
    err.message?.includes('タイムアウト') ||
-   [500, 502, 503].includes(err.status)
+   [500, 502, 503].includes(err.status) ||
+   err.message?.includes('Failed to fetch') ||
+   (err instanceof TypeError && !err.status)
```

---

## 修正3: `AiExplorer.jsx` — ユーザー向けエラーメッセージ改善

**ファイル:** [AiExplorer.jsx:18-28](src/pages/AiExplorer.jsx#L18-L28)

`formatAnalysisError()`で「Failed to fetch」を日本語メッセージに変換。既にインポート済みの`classifyError()`を活用:

```javascript
function formatAnalysisError(error) {
  if (error.isAuthError) return AUTH_EXPIRED_MESSAGE

  const info = classifyError(error)
  if (info.category === 'network') {
    return 'バックエンドへの接続に失敗しました。ネットワーク接続またはバックエンドの起動状態を確認し、再試行してください。'
  }
  if (info.category === 'cold_start') {
    return 'バックエンドサーバーが起動中です。1〜2分後に再試行してください。'
  }
  if (info.category === 'timeout') {
    return info.label + '。' + info.guidance
  }

  const msg = error.message || ''
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}
```

---

## 修正4: `AiExplorer.jsx` — MLコンテキスト読み込みにリトライ追加

**ファイル:** [AiExplorer.jsx:159-188](src/pages/AiExplorer.jsx#L159-L188)

`getScans()`失敗時、cold_start/networkエラーなら5秒後に1回自動リトライ。

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/api/adsInsights.js` | `neonGenerate()`の`allowProxyFallback`を`true`に |
| `src/pages/AiExplorer.jsx` | リトライ条件拡張・エラーメッセージ改善・MLリトライ追加 |

## 検証手順

1. `npm run dev` でローカル動作確認（プロキシモード、既存動作不变）
2. Vercelデプロイ後、AI考案ページでQuick Analysis実行 → 正常レスポンス確認
3. DevTools Network タブで、直接URL → プロキシフォールバックの流れを確認
4. Market Lens「+ Market Lens」切り替え → 履歴取得のリトライ動作確認
5. ネットワークオフライン時 → 改善された日本語エラーメッセージ確認
