# Plan: バックエンド統合 — 2サービス → 1サービス

## Context

現在 Render に market-lens-ai (Starter $7/月) と ads-insights (Free) の 2 サービスがあり、
デプロイ・環境変数・エラー管理が二重。ユーザーは「統合したのに別々のまま」に不満。
**1 つの Render サービスに統合し、管理コスト・デプロイの複雑さを解消する。**

## 方針: ASGI パスディスパッチャ

両 FastAPI アプリを **そのまま** 維持し、薄いディスパッチャでパスに応じて振り分ける。
14k行の `backend_api.py` をリファクタせず、最小リスクで統合できる。

```
Browser → Vercel → unified Render service
                      ├── /api/ml/*  → market-lens-ai app
                      └── /api/ads/* → ads-insights app
```

## 変更ファイル一覧

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `backends/market-lens-ai/unified_app.py` | **新規** — ASGIディスパッチャ (~50行) |
| 2 | `backends/market-lens-ai/requirements.txt` | ads-insights の依存を追加 |
| 3 | `backends/market-lens-ai/start.sh` | uvicorn エントリを `unified_app:app` に変更 |
| 4 | `render.yaml` | ads-insights サービス削除、env vars 統合 |
| 5 | `vercel.json` | rewrites + CSP を 1 URL に変更 |
| 6 | `vite.config.js` | dev proxy を 1 ポートに統合 |
| 7 | `src/api/marketLens.js` | direct backend URL 更新 |
| 8 | `src/api/adsInsights.js` | direct backend URL 更新 |

## Step 1: ディスパッチャ作成

`backends/market-lens-ai/unified_app.py` を新規作成:

```python
"""Unified ASGI dispatcher — routes /api/ml/* and /api/ads/* to respective apps."""
import sys, os
from pathlib import Path

# ads-insights を import できるよう sys.path に追加
ADS_DIR = str(Path(__file__).resolve().parent.parent / "ads-insights")
sys.path.insert(0, ADS_DIR)

from web.app.main import app as ml_app                        # market-lens
from web.app.backend_api import app as ads_app                 # ads-insights

class PrefixDispatcher:
    """
    /api/ml/* → ml_app  (strip "/ml", keep "/api")
    /api/ads/* → ads_app (strip "/ads", keep "/api")
    """
    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path.startswith("/api/ml/") or path == "/api/ml":
                scope = {**scope, "path": "/api" + path[7:], "root_path": ""}
                return await ml_app(scope, receive, send)
            if path.startswith("/api/ads/") or path == "/api/ads":
                scope = {**scope, "path": "/api" + path[8:], "root_path": ""}
                return await ads_app(scope, receive, send)
            # /api/health → unified health (or fallback to ml_app)
            return await ml_app(scope, receive, send)
        await ml_app(scope, receive, send)  # lifespan etc.

app = PrefixDispatcher()
```

パスの変換:
- `/api/ml/health` → ml_app が `/api/health` として受信
- `/api/ads/auth/login` → ads_app が `/api/auth/login` として受信

## Step 2: requirements.txt 統合

`backends/market-lens-ai/requirements.txt` に ads-insights 固有の依存を追加:
```
google-generativeai>=0.8.0
openpyxl>=3.1.0
pandas>=2.0.0
matplotlib>=3.7.0
pypdf>=3.0.0
numpy>=1.24.0
tabulate>=0.9.0
scipy>=1.10.0
google-cloud-bigquery>=3.0.0
db-dtypes>=1.0.0
bcrypt>=4.0.0
jinja2>=3.1.0
pathvalidate
```

## Step 3: start.sh 更新

```bash
exec uvicorn unified_app:app --host 0.0.0.0 --port "$PORT"
```

## Step 4: render.yaml 変更

- `ads-insights` サービス定義を **削除**
- `market-lens-ai` → 名前を `insight-studio-api` に変更（任意）
- ads-insights の env vars (APP_PASSWORD, GOOGLE_CREDENTIALS_JSON 等) を統合サービスに追加

## Step 5: Vercel 設定更新

`vercel.json` rewrites:
```json
{ "source": "/api/ml/:path*", "destination": "https://market-lens-ai.onrender.com/api/ml/:path*" }
{ "source": "/api/ads/:path*", "destination": "https://market-lens-ai.onrender.com/api/ads/:path*" }
```

CSP の `connect-src` から `ads-insights-9q5s.onrender.com` を削除。

## Step 6: フロントエンド API クライアント更新

**`src/api/adsInsights.js`:**
- `ADS_DIRECT_BASE` を `https://market-lens-ai.onrender.com/api/ads` に変更
- `BASE` は `/api/ads` のまま（Vercel proxy 経由なので変更不要）

**`src/api/marketLens.js`:**
- `DIRECT_BACKEND_BASE` を `https://market-lens-ai.onrender.com/api/ml` に変更

**`vite.config.js`:**
- 両方の proxy target を `http://localhost:8002` に統一
- rewrite: `/api/ml/*` → `/api/ml/*`（そのまま）、`/api/ads/*` → `/api/ads/*`（そのまま）

## Step 7: ads-insights の lifespan 対応

ディスパッチャの lifespan イベントで両アプリを初期化する必要がある。
ads_app の startup イベント（Drive フォルダクリーンアップ、BQ認証）を
unified_app の lifespan 内で明示的に呼ぶ。

## リスクと対策

| リスク | 対策 |
|--------|------|
| メモリ不足 (Starter 512MB) | デプロイ後 RSS 監視。超過なら Standard $25 に上げる |
| import 衝突 (両方に `web/app/`) | ads-insights は sys.path 経由で独立パスから読む |
| ads-insights の `BASE_DIR` パス | `Path(__file__).parents[2]` なので物理パスで解決、影響なし |
| 環境変数の衝突 | 衝突する変数: なし（ML は ANTHROPIC_*, ADS は APP_PASSWORD 等で分離済み） |

## デプロイ手順

1. コード変更をコミット＆プッシュ
2. Render Dashboard で ads-insights の env vars を market-lens-ai にコピー
3. PR → master マージ → Render 自動デプロイ
4. 動作確認後、Render Dashboard から ads-insights サービスを削除

## 検証方法

1. ローカル: `cd backends/market-lens-ai && uvicorn unified_app:app --port 8002`
2. `curl localhost:8002/api/ml/health` → market-lens 応答
3. `curl localhost:8002/api/ads/health` → ads-insights 応答
4. `curl -X POST localhost:8002/api/ads/cases/login -d '{"case_id":"saurus_japan","password":"Saurus2026"}'` → token 返却
5. フロントエンド `npm run dev` → 全ページ動作確認
6. Render デプロイ後: 本番 URL で同様の確認
