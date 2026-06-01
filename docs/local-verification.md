# ローカル / 本番 実運用確認ガイド

Insight Studio 本体（ログイン → ダッシュボード → 広告グラフ / AI考察）の動作確認手順。
**ローカル確認**と**本番確認**は環境も到達経路も別物なので、混同しないこと。

| | ローカル確認 | 本番確認 |
|---|---|---|
| URL | `http://localhost:3002` | `https://insight-studio-chi.vercel.app` |
| frontend | Vite dev server（このリポジトリのコード） | Vercel（デプロイ済み最新 master） |
| API 経路 | 同一オリジン `/api/*` → **vite proxy** → ローカル backend | Vercel rewrites → Render backend |
| backend | ローカル uvicorn（:8001 / :8002） | Render（ads-insights / market-lens） |
| APIキー / PW | **backend が `.env` から読む**（ブラウザに渡さない） | Render のダッシュボード環境変数 |
| 確認ツール | **右カラムのブラウザ（Claude Preview）でそのまま操作可** | headless Playwright で vercel.app を直接叩く（※下記） |

---

## 設計の原則（秘密値をブラウザに出さない）

- frontend は基本 **same-origin の `/api/ads` `/api/ml` `/api/insights`** だけを使う。
  localhost / Render静的ホスト では `SHOULD_FORCE_PROXY=true` となり、直叩きせず必ず proxy 経由になる
  （`src/api/adsInsights.js` / `src/api/marketLens.js`）。
- APIキー・管理者パスワード・JWT_SECRET は **backend だけが `.env` から読む**。
- Vite は `VITE_` で始まる変数のみブラウザバンドルへ露出する。
  **秘密値に `VITE_` を付けない**こと（付けるとバンドルに同梱され漏れる）。
  公開URL（`VITE_ADS_INSIGHTS_API_ORIGIN` 等）だけが `VITE_` 対象。

---

## 環境変数のキー名（正準名）

ゆれを統一する。**正準名以外はコードから読まれない**。

| 用途 | 正準名 | 読まれない旧名 | 参照順 / 補足 |
|---|---|---|---|
| Gemini APIキー | `GEMINI_API_KEY` | `Gemini_API_KEY`（混在ケース） | `GEMINI_API_KEY` → `GOOGLE_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` |
| Claude APIキー | `ANTHROPIC_API_KEY` | `Claude_API_KEY` | ads-insights は未使用 / market-lens-ai が使用 |
| 管理者PW | `APP_PASSWORD` | （日本語キー `管理者パスワード` は fallback で可） | 未設定だと backend 起動エラー |

`GEMINI_REQUIRE_CLIENT_KEY` で「サーバーキーを使うか／ブラウザ入力キーを使うか」を切替える:

- `false` … サーバーの `GEMINI_API_KEY` を全リクエストで使用（**.env 駆動のローカル確認はこちら**）
- `true`（アプリ既定）… 各ユーザーが UI で自分のキーを入力（サーバーキー不要）

---

## どの `.env` を誰が読むか

| ファイル | 読む主体 | 主なキー |
|---|---|---|
| リポジトリ root `.env` | ads-insights backend（`backend_api.py` が parents[4] を参照）＋ Vite | `APP_PASSWORD` `JWT_SECRET` `AUTH_USERS` `GEMINI_API_KEY` `GOOGLE_CREDENTIALS_JSON` `DATA_PROVIDER` `ADS_PROXY_TARGET` 等 |
| `backends/market-lens-ai/.env` | market-lens-ai backend（CWD基準） | `ANTHROPIC_API_KEY` `GEMINI_API_KEY` `DATABASE_URL` 等 |
| `backends/ads-insights/.env.local` | ads-insights backend（root `.env` より優先） | 個別上書き用（任意） |

テンプレートはそれぞれ `.env.example`（root） / `backends/*/.env.example`。

---

## ローカル確認の手順

### 1. `.env` を用意

```powershell
cp .env.example .env                       # root（ads-insights + Vite 用）
cp backends/market-lens-ai/.env.example backends/market-lens-ai/.env   # ML 用（任意）
```

`.env`（root）で最低限必要なもの:

- `APP_PASSWORD`（管理者ログイン）, `JWT_SECRET`
- `GEMINI_API_KEY` ＋ `GEMINI_REQUIRE_CLIENT_KEY=false`（AI考察をサーバーキーで動かす場合）
- BigQuery 認証（広告グラフ・AI考察に必須、下記）

### 2. BigQuery 認証（広告グラフ / AI考察を動かす場合のみ）

どちらか:

- **ADC（ローカル推奨）**: `gcloud auth application-default login` を実行（`GOOGLE_CREDENTIALS_JSON` は未設定のまま）
- **サービスアカウント**: 鍵JSONを Base64 化して `GOOGLE_CREDENTIALS_JSON` に設定

> 未設定だと、ログインとセットアップ画面までは動くが、wizard の期間取得 / レポート生成（`/api/ads/bq/*`）が失敗する。

### 3. 起動

```powershell
./dev.ps1        # backend ×2 (:8001 ads, :8002 ml) + frontend (:3002) を一括起動
# 個別なら:
#   cd backends/market-lens-ai && uvicorn web.app.main:app --port 8002 --reload
#   cd backends/ads-insights  && uvicorn web.app.backend_api:app --port 8001 --reload --timeout-keep-alive 300
#   npm run dev
```

proxy の転送先を変えたい場合は root `.env` に `ADS_PROXY_TARGET` / `ML_PROXY_TARGET` を設定。

### 4. ブラウザで確認（`http://localhost:3002`）

右カラムのブラウザ（Claude Preview）でそのまま操作できる:

1. 未ログインで `/` → `/login` に飛ぶ
2. 管理者パスワードでログイン → ダッシュボード表示
3. 左ナビ「広告分析 → セットアップ」で `/ads/wizard`
4. 未設定なら `/ads/graphs` `/insights/ai` は `/ads/wizard` に誘導される
5. wizard を完走（クエリタイプ・期間を選択 → レポート生成）すると `/ads/graphs` が表示される
6. `/insights/ai` で AI考察（要 Gemini サーバーキー or BYOK）

### 5. ビルド確認

```powershell
npm run build
```

---

## トラブルシュート（ローカル）

- **ログインはできるが wizard の期間取得 / レポート生成が失敗する** … BigQuery 認証が未設定。
  `gcloud auth application-default login`（ADC）を実行するか `GOOGLE_CREDENTIALS_JSON` を設定する。
- **`Ads Insights API error: 502`（generate_batch）** … 選択したクエリタイプが**全て失敗**すると backend が
  502 を返す。原因は (a) その期間にデータが無い（例: petabit には CV データが無く `cv` は no_data）、
  (b) 特定クエリの処理エラー。別のクエリタイプ（流入分析・デバイス分析など）で切り分ける。
- **BigQuery クエリが遅い（初回 ~15s）** … `information_schema` 走査のため初回は時間がかかる。
  uvicorn が単一 worker だと長い同期クエリ中に並行リクエストが 502 になりうる。確認時は連打しない。
- **起動時に `python-dotenv could not parse ...`** … `.env` にスペースを含むキー名がある（例 `Render API=`）。
  キー名は `[A-Za-z_][A-Za-z0-9_]*` にする（不要なら行をコメントアウト）。

## 本番確認（混同しないこと）

本番は `https://insight-studio-chi.vercel.app`。**右カラムの Claude Preview は dev origin（localhost:3002）に固定**されており、
`window.location` でも外部 fetch でも本番 vercel.app には到達できない（egress ブロック）。
そのため本番の実運用確認は **headless Playwright で vercel.app を直接叩く**方式で行う
（証跡スクショは headless で撮って共有する）。ローカル確認とは別物として扱う。
