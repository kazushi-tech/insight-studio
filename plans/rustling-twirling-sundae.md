# Fix: Discovery / Compare タイムアウト — バックエンド根本修正

## Context

フロントエンドのタイムアウト調整を何度繰り返しても解決しなかった。根本原因は**バックエンド側のタイムアウト設定**にある。

- `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC` = 150s（全体ジョブ上限）
- `DISCOVERY_ANALYZE_TIMEOUT_SEC` = 90s（パイプライン）vs 150s（ルート）**← 二重定義で不整合**

全ステージ合計の理論最大値（10+6+45+12+90 = 163s）が全体上限150sを超える構造的バグ。

## 修正内容

### 1. バックエンド: タイムアウトの一元化と引き上げ

**ファイル: `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`**

`_resolve_timeouts()` のデフォルト値を引き上げ:
```
analyze_timeout: 90 → 180
search_timeout: 45 → 90
```

**ファイル: `market-lens-ai/web/app/routers/discovery_routes.py`**

全体ジョブタイムアウトを引き上げ:
```
DISCOVERY_OVERALL_JOB_TIMEOUT_SEC: 150 → 300
```

ルート側のデフォルト値もパイプラインと統一。

### 2. バックエンド: Render にデプロイ

`git push` → Render 自動デプロイ

### 3. フロントエンド: 現状維持

Codex + わらわの修正で既に十分:
- `LONG_ANALYSIS_TIMEOUT = 240s` (Compare scan)
- `POLL_MAX_DURATION_MS = 360s` (Discovery polling)
- per-stage stall detection 削除済み
- auto-resubmit 実装済み

## 変更ファイル

| ファイル | 変更 |
|---------|------|
| `market-lens-ai/.../discovery_pipeline.py` | analyze 90→180s, search 45→90s |
| `market-lens-ai/.../discovery_routes.py` | overall 150→300s, ルート側デフォルト統一 |

## 検証

1. バックエンドデプロイ完了確認（health endpoint）
2. Discovery: hits-online.jp で analyze ステージがタイムアウトしないこと
3. Compare: hits-online.jp + cera.co.jp で分析完了すること
