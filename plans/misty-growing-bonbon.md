# 緊急修正: Discovery handleDiscover 無限フリーズ問題

## Context

本番環境（Vercel デプロイ）で Discovery Hub の「ジョブ発見中…」が **10分以上フリーズ** する事象が発生。
DevTools Console から原因を特定済み。

### Console ログ（実際の出力）

```
[Discovery] handleDiscover start ▶ Object     ← 開始した
                                                ← ★ ここで途絶えている
[Compare] handleScan called ▶ Object           ← 別操作（Compare は成功）
[Compare] Backend warm, submitting scan
⚠️ [Compare] scan timeout on attempt 0, re-verifying backend
[Compare] Scan completed ▶ Object
```

**`[Discovery] handleDiscover start` の後、ポーリングログ `[Discovery] tick` が1件も出ていない。**

## 根本原因

### handleDiscover の構造的欠陥

```
handleDiscover
  ├── await warmMarketLensBackend()    ← ★ ここ or
  ├── await startDiscoveryJob()        ← ★ ここが無限ハング
  └── pollJob()                        ← 到達しない
        ├── stale検知 (45s)            ← 全て pollJob 内
        ├── hard ceiling (300s)        ← 到達しないので
        └── network error (3回)        ← 発動しない
```

**全ての安全弁（stale検知、hard ceiling、ネットワークエラー閾値）が `pollJob` 内にあるため、
ポーリング開始前にフリーズすると全てすり抜ける。**

### なぜフリーズするか

本番環境（Vercel）では `SHOULD_FORCE_PROXY = false`（hostname が localhost でない）。
そのため `warmMarketLensBackend()` → `ensureDirectBackend()` が実行され、
`https://market-lens-ai.onrender.com/api/health` への直接リクエストが飛ぶ。

`ensureDirectBackend` のリトライ設計上は最大 ~105秒で返るはずだが:
- CORS プリフライトのハング
- Render 無料枠のコールドスタートでの長時間無応答
- `requestDiscoveryJobWithRetry` の直接バックエンド接続がハング

のいずれかで `await` が返ってこない状態になっている可能性が高い。

### なぜテストで検知できなかったか

テストでは `warmMarketLensBackend` と `startDiscoveryJob` を `vi.mock` でモックしており、
即座に resolve するため、この経路は通っていない。
また jsdom では `SHOULD_FORCE_PROXY = true` のため `ensureDirectBackend` 自体が呼ばれない。

---

## 修正内容

### 修正 1: handleDiscover にオーバーアーキング・タイムアウト追加（最重要）

**ファイル:** `src/pages/Discovery.jsx`

**変更箇所:** `handleDiscover` 関数（行 684-746）

```javascript
// 修正前:
try {
  updateRunMeta('discovery', { stage: 'warming' })
  const warmResult = await warmMarketLensBackend()   // ← 無限ハングの可能性
  // ...
  const data = await startDiscoveryJob(url, requestOptions)  // ← 同上
  // ...
  pollJob(data.job_id, { ... })
} catch (e) {
  failRun(...)
}

// 修正後:
const PRE_POLL_TIMEOUT_MS = 60_000  // ウォームアップ + ジョブ作成の合計上限

try {
  updateRunMeta('discovery', { stage: 'warming' })

  // ── ウォームアップ + ジョブ作成を 60秒でタイムアウト ──
  const data = await Promise.race([
    (async () => {
      const warmResult = await warmMarketLensBackend()
      if (!warmResult) {
        throw Object.assign(new Error('サーバー起動に失敗しました'), {
          isPrePollTimeout: false,
          category: 'cold_start',
        })
      }
      updateRunMeta('discovery', { stage: 'queued', warmEndedAt: Date.now() })
      return await startDiscoveryJob(url, requestOptions)
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(
        new Error('サーバーへの接続がタイムアウトしました。再試行してください。'),
        { isPrePollTimeout: true }
      )), PRE_POLL_TIMEOUT_MS)
    ),
  ])

  // (既存の updateRunMeta / persistActiveJob / pollJob はそのまま)

} catch (e) {
  if (e.isPrePollTimeout) {
    failRun('discovery', e.message, {
      category: 'timeout', label: '接続タイムアウト',
      guidance: 'サーバーへの接続に60秒以上かかりました。再試行してください。',
      retryable: true,
    })
  } else if (e.category === 'cold_start') {
    failRun('discovery', e.message, {
      category: 'cold_start', label: 'サーバー起動失敗',
      guidance: 'バックエンドが起動できませんでした。', retryable: true,
    })
  } else {
    const info = classifyError(e)
    failRun('discovery', e.message, info)
  }
}
```

**効果:** warmup や job creation が何らかの理由でハングしても、60秒後に必ずエラー表示される。

### 修正 2: デバッグログ追加（調査用）

warmup の前後にログを追加し、次回同様の問題が起きた時に原因を即座に特定できるようにする。

```javascript
console.info('[Discovery] warmup starting...')
const warmResult = await warmMarketLensBackend()
console.info('[Discovery] warmup result:', warmResult)
// ...
console.info('[Discovery] submitting job...')
const data = await startDiscoveryJob(url, requestOptions)
console.info('[Discovery] job started:', data.job_id)
```

### 修正 3: テスト追加

**ファイル:** `src/pages/__tests__/Discovery.polling.test.jsx` に追加

```
11. ウォームアップがタイムアウトした場合のエラー表示
    - warmMarketLensBackend を永続的に pending な Promise に設定
    - 60秒進行
    - 検証: エラーバナー「タイムアウト」が表示される

12. ジョブ作成がタイムアウトした場合のエラー表示
    - startDiscoveryJob を永続的に pending な Promise に設定
    - 60秒進行
    - 検証: エラーバナーが表示される
```

---

## 対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/pages/Discovery.jsx` | handleDiscover にタイムアウト + デバッグログ追加 |
| `src/pages/__tests__/Discovery.polling.test.jsx` | テスト 2件追加 |

## 検証方法

1. `npm test` — 全テスト通過（102件）
2. `npm run build` — ビルド成功
3. **本番再現テスト:** デプロイ後、Discovery Hub で URL を入力して実行
   - 正常時: 通常通りポーリング → 結果表示
   - バックエンド停止時: **60秒以内に** タイムアウトエラーが表示される（10分フリーズしない）
4. DevTools Console で `[Discovery] warmup starting...` → `[Discovery] warmup result:` のログが出ることを確認

## 完了基準

- [ ] handleDiscover に 60秒タイムアウトが設定されている
- [ ] デバッグログが warmup / job creation の前後に追加されている
- [ ] テスト 2件が追加され、全テスト通過
- [ ] 本番デプロイ後にフリーズしないことを確認
