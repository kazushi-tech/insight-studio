# `bigquery_not_configured` エラー対応プラン

## Context

本番環境（Vercel→Render 統合バックエンド `market-lens-ai`）で `/api/ads/bq/generate_batch` が HTTP 500 を返し、フロントに `bigquery_not_configured` が表示される。

原因の有力仮説は 2 つ:

1. **モノレポ統合時の `sys.path` 問題** — [unified_app.py](backends/market-lens-ai/unified_app.py) は ads と ML の `web.app.*` 競合を避けるため `sys.path` を差し替えている。ads の BQ モジュール (`bq.*`) は遅延 import されるため、ルートハンドラ実行時点で `ADS_DIR` が `sys.path` 末尾に移動しており、`ImportError` 発生 → 500。
2. **Render 環境変数 `GOOGLE_CREDENTIALS_JSON` 未設定または壊れた値** — [render.yaml:58](render.yaml#L58) は `sync: false` のため Dashboard で手動設定が必要。

現在のブランチ `fix/bq-import-startup-preload` は仮説 1 を狙う修正 (コミット `48e0cae`) を含むが、**未マージ・未デプロイ**。また `/api/bq/_health` 診断エンドポイントも追加済みだが、これも未デプロイ。

**ゴール**: 本プラン完了時点で Setup Wizard が `bigquery_not_configured` を出さずに BQ レポート生成まで到達する。

補足: スクショの `/api/ads/auth/login` 401 は「ゲスト状態で未ログイン」を示す想定動作。BQ エラーとは独立した事象（BQ エンドポイントには JWT が必要なので、ログイン後でないと再現テストできない点は留意）。

## 推奨アプローチ

**段階的検証**で進める。余計な改修を先回りせず、診断 → 原因特定 → 最小修正の順。

### Step 1 — 現ブランチを本番に反映する

- `fix/bq-import-startup-preload` から PR 作成 → `master` へマージ → Render 自動デプロイ。
- デプロイ完了後、Render ログに以下のいずれかが出ているか確認:
  - `[unified_app] BigQuery modules pre-loaded OK` → 仮説 1 の修正が効いている
  - `[unified_app] BigQuery modules not available: <msg>` → 別の根本原因あり（Step 3 へ）

### Step 2 — `/api/bq/_health` で診断（認証不要）

ブラウザ or `curl` で `https://market-lens-staging.onrender.com/api/ads/bq/_health` を叩き、返却 JSON を確認。エンドポイント実装は [backend_api.py:14188-14212](backends/ads-insights/web/app/backend_api.py#L14188-L14212)。

**判定マトリクス:**

| `bq_client` | `bq_auth_available` | 判断 | 対応 |
|-------------|---------------------|------|------|
| OK | true | 修正成功 | Step 4 へ |
| OK | false | 認証情報不足 | Step 3a |
| FAIL (ImportError) | — | import チェーン未解決 | Step 3b |

### Step 3a — 認証情報の修正（`bq_auth_available: false` の場合）

- Render Dashboard → `market-lens-ai` サービス → Environment で `GOOGLE_CREDENTIALS_JSON` が **Base64** 形式で設定されているか確認。
- 未設定なら、ads-insights の元サービス (`ads-insights-staging`) から値をコピーして設定。
- 認証ロジックは [bq/auth.py:setup_credentials](backends/ads-insights/bq/auth.py#L14-L45) — Base64 デコード失敗時は `[bq-auth] Failed to setup credentials` ログが出る。

### Step 3b — import 失敗の根本原因特定（`bq_client: FAIL` の場合）

`debug_traceback` フィールドから判定:

- `No module named 'google.cloud'` または `pandas` → `backends/market-lens-ai/requirements.txt` に `google-cloud-bigquery`, `pandas` が含まれているか確認（ads-insights の requirements 由来なので、unified 後は ML 側の requirements に追加が必要な可能性）。
- `No module named 'bq'` → `unified_app.py` の pre-import ブロック（[unified_app.py:21-31](backends/market-lens-ai/unified_app.py#L21-L31)）が `sys.path` 差し替え**前**に実行されているか再確認。
- それ以外 → traceback に応じて個別対応。

**絶対にやらないこと**（過去 feedback より）:
- タイムアウト値の増加での誤魔化し
- 表面的な try/except での握り潰し
- 推測だけでのコード変更（traceback を見てから判断）

### Step 4 — エンドツーエンド検証

1. `https://insight-studio-chi.vercel.app/ads/wizard` を開く
2. 通常ログイン → Setup Wizard で期間選択 → 「次へ」
3. レポート生成が `bigquery_not_configured` なしで進行することを確認
4. Chrome DevTools Console に `/api/ads/bq/generate_batch` の 500 エラーが出ないことを確認
5. 成功後、`/api/bq/_health` 診断エンドポイントは本番から撤去する別 PR を作る（未来タスク）

## 修正対象ファイル（現時点で想定される範囲）

- 追加改修なし（現ブランチのコミット `48e0cae` をマージするだけで解決する可能性が高い）
- Step 3a 発動時: Render Dashboard のみ（コード変更なし）
- Step 3b 発動時（依存不足の場合）: [backends/market-lens-ai/requirements.txt](backends/market-lens-ai/requirements.txt)

## 参照（既存実装の再利用）

- BQ ヘルスチェック: [backend_api.py:14188](backends/ads-insights/web/app/backend_api.py#L14188)
- 認証セットアップ: [bq/auth.py](backends/ads-insights/bq/auth.py)
- BQ クライアント: [bq/client.py](backends/ads-insights/bq/client.py)
- unified ディスパッチャ: [unified_app.py](backends/market-lens-ai/unified_app.py)

## 検証方法サマリ

```bash
# 1. ヘルスチェック（認証不要）
curl https://market-lens-staging.onrender.com/api/ads/bq/_health

# 2. ログイン後に generate_batch 動作確認
#    （フロントから Setup Wizard 経由で実行）
```

成功条件: `bq_client: OK`、`bq_auth_available: true`、`bq_in_sys_modules` に `bq.client`/`bq.queries`/`bq.reporter`/`bq.auth` が含まれる。
