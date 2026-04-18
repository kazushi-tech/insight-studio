# Insight Studio

Market Lens AI と考察スタジオ(ads-insights)を統合した広告運用・競合分析SaaSダッシュボード（PC専用）。

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| Frontend | Vite + React + Tailwind CSS v4 |
| Routing | React Router |
| Backend (ML) | Python / FastAPI / PostgreSQL / Alembic |
| Backend (Ads) | Python / FastAPI / BigQuery |
| Font | Manrope + Material Symbols Outlined |
| Deploy Frontend | Vercel |
| Deploy Backend | Render (Starter plan) |
| Design | Stitch 2.0 エクスポート準拠 |

## アーキテクチャ

モノレポ構成。フロントエンドはルート、バックエンド2つは `backends/` 配下。

```
insight-studio/
├── src/                              # React frontend (Vercel)
├── backends/
│   ├── market-lens-ai/               # Python/FastAPI (Render: market-lens-staging)
│   │   ├── web/app/                  # FastAPIアプリ本体
│   │   ├── alembic/                  # DB migrations
│   │   ├── config/                   # ポリシー設定
│   │   └── tests/                    # pytest
│   └── ads-insights/                 # Python/FastAPI (Render: ads-insights-staging)
│       ├── web/app/                  # FastAPIアプリ本体
│       ├── bq/                       # BigQuery統合
│       ├── chart_generator.py        # ルートレベル (sys.path経由でimport)
│       └── tests/
├── vercel.json                       # 本番APIプロキシ rewrites
├── render.yaml                       # Render デプロイ設定
└── dev.ps1                           # 全サービス一括起動
```

### APIルーティング

- **本番:** Vercel rewrites → Render URL（`vercel.json`）
- **ローカル開発:** Vite proxy → localhost（`vite.config.js`）
  - `/api/ml/*` → `localhost:8002` (market-lens-ai)
  - `/api/ads/*` → `localhost:8001` (ads-insights)

## ディレクトリ構成

```
src/
  components/   共通コンポーネント（Layout等）
  pages/        各画面コンポーネント
  index.css     Tailwind v4 テーマ定義
  App.jsx       ルーティング
  main.jsx      エントリポイント
backends/
  market-lens-ai/    Market Lens AI バックエンド
  ads-insights/      考察スタジオ バックエンド
vercel.json          APIプロキシ rewrites (本番用)
render.yaml          Render デプロイ設定
dev.ps1              ローカル開発 全サービス一括起動
```

## 標準コマンド

```bash
# Frontend
npm install          # 依存インストール
npm run dev          # 開発サーバー（port 3002）
npm run build        # プロダクションビルド

# Backend (market-lens-ai)
cd backends/market-lens-ai
pip install -r requirements.txt
uvicorn web.app.main:app --host 127.0.0.1 --port 8002 --reload

# Backend (ads-insights)
cd backends/ads-insights
pip install -r requirements.txt
uvicorn web.app.backend_api:app --host 127.0.0.1 --port 8001 --reload --timeout-keep-alive 300

# 全サービス一括起動 (PowerShell)
./dev.ps1

# 動作確認（Playwright、初回のみ）
pip install playwright
python -m playwright install chromium
```

## テスト

```bash
# Frontend
npm run build        # ビルド確認

# Backend (market-lens-ai)
cd backends/market-lens-ai && python -m pytest

# Backend (ads-insights)
cd backends/ads-insights && python -m pytest
```

## 動作確認（Playwright）

`src/` 配下（React フロント）を変更したら、`webapp-testing` skill を使って Claude 自身が画面を開き、変更の反映と関連画面のリグレッションを確認してから完了報告する。

### 対象

- **やる:** `src/` 配下のコード変更（components / pages / App.jsx / index.css など）
- **対象外:** `backends/` のみの変更（pytest で足りる）、ドキュメント・設定のみの変更

### 手順

1. `npm run build` で型・ビルド確認
2. `webapp-testing` skill の `scripts/with_server.py` で `npm run dev`（port 3002）を起動
3. Playwright sync API で変更画面を開き、挙動を確認
4. **隣接画面も1つ以上**開いて regression 確認（Layout や共通コンポーネントを共有する画面）
5. `page.on('console', ...)` でコンソールエラー／ネットワークエラーを拾い、結果と合わせて報告

### ルール

- 追加の npm 依存（`@playwright/test` 等）は入れない。`webapp-testing` skill（Python + Playwright sync API）を使う
- ユーザーの許可を求めず自律的に実行する（`feedback_no_confirmation` に準拠）
- タイムアウトが出たら値を増やさず根本原因を探す（`feedback_never_increase_timeouts` に準拠）
- 初回のみ `pip install playwright && python -m playwright install chromium` が必要

## デザインシステム

- **配色:** Botanical Green (#003925) + 植物系グリーンパレット、warm off-white (#fafaf5) 背景ベース
- **フォント:** Manrope（日英対応）
- **カード:** border-radius 16px、ボーダーなし、トーナルレイヤリング
- **ボタン:** border-radius 12px、ゴールドアクセント
- **モード:** ライトモードデフォルト

## 統合元サービス

| サービス | Render サービス名 | バックエンドURL |
| ---------- | ------------------ | --------------- |
| Market Lens AI | market-lens-staging | market-lens-ai.onrender.com |
| 考察スタジオ | ads-insights-staging | ads-insights-9q5s.onrender.com |
