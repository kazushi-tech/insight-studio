# 根本修正: 競合分析/発見 エラー撲滅プラン

## Context

**問題:** Discovery Hub（発見）と Compare（競合分析）が本番環境でほぼ100%エラーになる。
一方、AI考察（ads-insights）はほぼ100%安定している。

**これまでの対処が的外れだった理由:**
- 60秒タイムアウト追加 → 「10分フリーズ」が「60秒でエラー表示」に変わっただけ
- エラー自体は消えていない
- DevToolsのログを見て表面的に診断するだけで、根本原因に手を入れていなかった

**根本原因（3層）:**

| 層 | 原因 | 影響度 |
|----|------|--------|
| 1. インフラ | market-lens-ai が Render 無料枠で15分無操作で眠る。コールドスタートに45-60秒 | 80% |
| 2. フロントエンド | warmup関数が最大105秒かかる（60秒タイムアウトを超過）、Compare にタイムアウトなし | 15% |
| 3. バックエンド | analyze ステージの stale 検知が90秒で504を返す（LLM応答遅延時に発火） | 5% |

---

## Phase 1: Render 有料プラン移行（最重要）

### 手順

1. https://dashboard.render.com にログイン
2. 左メニューから **market-lens-staging** サービスを選択
3. **Settings** タブを開く
4. **Instance Type** セクションで **Starter ($7/month)** を選択
   - Starter: 512MB RAM, 0.5 CPU, **常時稼働（スリープなし）**
5. **Save Changes** をクリック
6. 支払い情報を入力（未登録の場合）
7. 再デプロイが自動的に開始される

### 効果

- コールドスタート問題が **完全に消える**
- health check が常に 1-2秒で返る（現在は45-60秒）
- warmup関数が即座に成功する
- これだけでエラー率が 80%以上改善する見込み

### 確認方法

```bash
# デプロイ完了後、health check が即座に返ることを確認
curl -w "\n%{time_total}s" https://market-lens-ai.onrender.com/api/health
# 期待値: 1-2秒以内にレスポンス（現在は10秒以上 or タイムアウト）
```

---

## Phase 2: フロントエンド修正（insight-studio）

Render有料化後も残る構造的問題を修正する。

### 修正 2-1: warmup の health check タイムアウト短縮

**ファイル:** `src/api/marketLens.js` 行 588

**理由:** 有料プランでは health が 1-2秒で返る。30秒も待つ必要がない。
warmup 全体が最大105秒かかる原因を潰す。

```javascript
// 修正前（行 588-591）:
const res = await fetch(`${DIRECT_BACKEND_BASE}/health`, {
  method: 'GET',
  signal: AbortSignal.timeout(30000),  // ← 30秒は長すぎる
})

// 修正後:
const res = await fetch(`${DIRECT_BACKEND_BASE}/health`, {
  method: 'GET',
  signal: AbortSignal.timeout(10000),  // ← 10秒に短縮
})
```

**効果:** warmup 最大所要時間が 105秒 → 45秒に短縮。Discovery の60秒タイムアウト内に収まる。

### 修正 2-2: Compare に warmup タイムアウト追加

**ファイル:** `src/pages/Compare.jsx` 行 354-371

**理由:** Compare の handleScan は `await warmMarketLensBackend()` を無制限に待つ。
warmup がハングすると無限フリーズする（Discovery と同じ構造的欠陥）。

```javascript
// 修正前（行 354-371）:
try {
  updateRunMeta('compare', { statusLabel: 'サーバー起動待ち…' })
  const warmResult = await warmMarketLensBackend()
  if (!warmResult) {
    failRun('compare', 'サーバー起動に失敗しました。...', { ... })
    return
  }
  console.info('[Compare] Backend warm, submitting scan')
  const data = await scan(urlList, { ... })

// 修正後:
try {
  updateRunMeta('compare', { statusLabel: 'サーバー起動待ち…' })

  // ── warmup を 45秒でタイムアウト ──
  let warmResult
  try {
    warmResult = await Promise.race([
      warmMarketLensBackend(),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(
          new Error('サーバーへの接続がタイムアウトしました。再試行してください。'),
          { isWarmupTimeout: true }
        )), 45_000)
      ),
    ])
  } catch (warmErr) {
    if (warmErr.isWarmupTimeout) {
      failRun('compare', warmErr.message, {
        category: 'timeout', label: '接続タイムアウト',
        guidance: 'サーバーへの接続に時間がかかりすぎました。再試行してください。',
        retryable: true,
      })
    } else {
      failRun('compare', warmErr.message || 'サーバー起動に失敗しました。', {
        category: 'cold_start', label: 'サーバー起動失敗',
        guidance: 'バックエンドが起動できませんでした。', retryable: true,
      })
    }
    return
  }
  if (!warmResult) {
    failRun('compare', 'サーバー起動に失敗しました。しばらく待って再試行してください。', {
      category: 'cold_start', label: 'サーバー起動失敗',
      guidance: 'バックエンドが起動できませんでした。ネットワーク接続を確認してください。',
      retryable: true,
    })
    return
  }
  console.info('[Compare] Backend warm, submitting scan')
  const data = await scan(urlList, { ... })
```

**効果:** Compare も warmup ハングから保護される。45秒以内にエラー表示。

### 修正 2-3: Discovery ジョブ作成のプロキシフォールバック無効化

**ファイル:** `src/api/marketLens.js` 行 398

**理由:** `allowProxyFallback: true` のため、直接接続が失敗するとVercelプロキシ経由にフォールバック。
しかしVercelプロキシは60秒制限があり、ジョブ作成が遅い場合にタイムアウトする。

```javascript
// 修正前（行 392-399）:
return await requestJson('/discovery/jobs', {
  method: 'POST',
  body: JSON.stringify(payload),
  timeout: 30000,
  direct: true,
  directStrategy: attempt === 0 ? 'optimistic' : 'verified',
  allowProxyFallback: true,   // ← Vercel 60秒制限に引っかかる
})

// 修正後:
return await requestJson('/discovery/jobs', {
  method: 'POST',
  body: JSON.stringify(payload),
  timeout: 30000,
  direct: true,
  directStrategy: attempt === 0 ? 'optimistic' : 'verified',
  allowProxyFallback: false,  // ← プロキシフォールバックを無効化
})
```

**効果:** Vercel の60秒制限による二重タイムアウトを防止。

---

## Phase 3: 動作確認（Render有料化 + フロントエンド修正後）

### 確認 1: バックエンド health check

```bash
curl -w "\n%{time_total}s" https://market-lens-ai.onrender.com/api/health
# 期待: 1-2秒以内にレスポンス
```

### 確認 2: テスト全通過

```bash
cd /c/Users/PEM\ N-266/work/insight-studio
npm test -- --run
# 期待: 全テスト通過（102件 + 追加分）
```

### 確認 3: ビルド成功

```bash
npm run build
# 期待: エラーなし
```

### 確認 4: 本番動作テスト

1. Vercel にデプロイ
2. Discovery Hub でURL入力 → 「発見を開始」
   - **期待:** ポーリングが正常に進行し、結果が表示される
   - **許容:** バックエンドのLLM遅延による504エラー（リトライで解決）
3. Compare でURL2件入力 → 「分析開始」
   - **期待:** 分析が完了し、レポートが表示される
4. AI考察 → 既存の安定性が維持されていること

### 確認 5: エラーシナリオ

- バックエンドが一時的に遅い場合: warmup が数秒で完了 → 正常動作
- LLMが遅延した場合: バックエンドの stale 検知で504 → フロントエンドにリトライ可能エラー表示
- ネットワーク障害の場合: warmup 失敗 → 45秒以内にエラー表示

---

## 対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/api/marketLens.js` | health check タイムアウト 30s→10s、ジョブ作成 proxyFallback 無効化 |
| `src/pages/Compare.jsx` | warmup に45秒タイムアウト追加 |
| Render Dashboard | market-lens-staging を Starter プラン($7/month)に変更 |

## 完了基準

- [ ] Render が Starter プラン（常時稼働）で動作している
- [ ] health check が 2秒以内に返る
- [ ] `ensureDirectBackend` の per-attempt タイムアウトが 10秒
- [ ] Compare に warmup タイムアウトが設定されている
- [ ] Discovery ジョブ作成のプロキシフォールバックが無効
- [ ] 全テスト通過
- [ ] ビルド成功
- [ ] 本番で Discovery / Compare が正常動作する
