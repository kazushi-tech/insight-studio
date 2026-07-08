# Plan: brand_fetch タイムアウト根本修正

## Context

brand_fetch が heavy site（muji.com 等）で必ずタイムアウトする。前回 render.yaml に `DISCOVERY_BRAND_FETCH_TIMEOUT_SEC=30` を追加したが、**3つのレイヤー**が連鎖して失敗している。

### タイムアウト連鎖（現状）

```
brand_fetch_timeout = 30s (per URL)
↓
brand_fetch は最大4候補URLを順に試す
  → 最悪 4 × 32s = 128s かかる
↓
stall_timeout = max(30 + 20, 30) = 50s  ← ココが問題!
  → 50sでstall判定 → ジョブ失敗
↓
frontend STAGE_TIMEOUT_MS.brand_fetch = 30s ← さらに短い
  → バックエンドより先に諦める
```

**根本原因**: stall timeout の計算式 `max(brand_fetch_timeout + 20, 30)` は単一URL前提。4候補URLを順に試すパイプライン構造とミスマッチしている。

---

## 修正内容

### 1. バックエンド stall timeout 計算式修正

**ファイル**: `market-lens-ai/web/app/routers/discovery_routes.py` (line 296)

```python
# Before:
DiscoveryJobStage.brand_fetch: max(_brand_fetch_timeout + 20.0, 30.0),

# After: 候補URL最大4つ分の予算を確保
DiscoveryJobStage.brand_fetch: max(_brand_fetch_timeout * 4 + 20.0, 60.0),
```

brand_fetch_timeout=60s → stall = max(260, 60) = 260s（十分な余裕）

### 2. render.yaml タイムアウト値更新

**ファイル**: `market-lens-ai/render.yaml`

```yaml
# Before:
- key: DISCOVERY_BRAND_FETCH_TIMEOUT_SEC
  value: "30"
- key: DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC
  value: "20"

# After:
- key: DISCOVERY_BRAND_FETCH_TIMEOUT_SEC
  value: "60"
- key: DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC
  value: "45"
- key: DISCOVERY_OVERALL_JOB_TIMEOUT_SEC
  value: "300"
```

- brand_fetch: 30s → 60s (per URL attempt)
- competitor_fetch: 20s → 45s
- overall: 150s (default) → 300s (brand_fetch最大260s + 残ステージ分)

### 3. フロントエンド タイムアウト延長

**ファイル**: `insight-studio/src/pages/Discovery.jsx`

```javascript
// Before:
const POLL_MAX_DURATION_MS = 180_000 // 3min
const STAGE_TIMEOUT_MS = {
  queued: 30_000,
  brand_fetch: 30_000,
  classify_industry: 30_000,
  search: 70_000,
  fetch_competitors: 45_000,
  analyze: 150_000,
}

// After:
const POLL_MAX_DURATION_MS = 360_000 // 6min
const STAGE_TIMEOUT_MS = {
  queued: 30_000,
  brand_fetch: 130_000,    // 60s × 2URL + buffer
  classify_industry: 30_000,
  search: 90_000,
  fetch_competitors: 60_000,
  analyze: 180_000,
}
```

---

## 変更ファイル一覧

| リポ | ファイル | 修正内容 |
|------|---------|---------|
| market-lens-ai | `web/app/routers/discovery_routes.py` | stall timeout 計算式修正 |
| market-lens-ai | `render.yaml` | タイムアウト値更新 + overall追加 |
| insight-studio | `src/pages/Discovery.jsx` | stage/poll タイムアウト延長 |

## 検証方法

1. market-lens-ai を push → Render デプロイ完了待ち
2. insight-studio を push → Vercel デプロイ
3. Discovery Hub で muji.com を入力
4. brand_fetch がタイムアウトせずに完了することを確認
