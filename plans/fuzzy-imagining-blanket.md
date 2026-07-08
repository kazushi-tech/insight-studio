# Monorepo Migration Plan — insight-studio

## Context

**Problem:** バックエンド2つ（market-lens-ai, ads-insights）が別リポジトリにあり、エラー発生時にClaudeがフロントエンドしか見えず、デバッグに時間がかかる。RenderはStarter有料プランを課金済み（コールドスタートは解消済み）だが、クロススタックなエラー原因調査にリポジトリをまたぐ手間が大きい。

**Goal:** 3つのリポジトリを1つのモノレポに統合し、Claudeがフロントエンド+バックエンド全体を同時にデバッグできるようにする。

**User preference:** タスク量が多いため、agent teams + skillsを駆使して並列実行する。

---

## Target Structure

```
insight-studio/                        # Git root
├── src/                               # ← React frontend (そのまま)
├── public/
├── package.json
├── vite.config.js                     # 変更: ローカル開発proxy → localhost
├── vercel.json                        # 変更なし (本番proxyはRender URLのまま)
├── render.yaml                        # 新規: 統合Renderデプロイ設定
├── dev.ps1                            # 新規: 全サービス一括起動スクリプト
├── CLAUDE.md                          # 更新: モノレポ構成を記載
│
└── backends/                          # 新規: バックエンド2つ
    ├── market-lens-ai/                # Python/FastAPI (Render: port auto)
    │   ├── web/app/                   # FastAPIアプリ本体
    │   ├── alembic/                   # DB migrations
    │   ├── config/                    # ポリシー設定
    │   ├── tests/                     # pytest
    │   ├── requirements.txt
    │   └── .env.example
    │
    └── ads-insights/                  # Python/FastAPI (Render: port auto)
        ├── web/app/                   # FastAPIアプリ本体
        ├── bq/                        # BigQuery統合
        ├── chart_generator.py         # ルートレベル (sys.path経由でimport)
        ├── tests/
        ├── requirements.txt
        └── .env.example
```

**Frontend stays at root** — 移動するとVercel/Vite/imports全てに影響するため。backends/だけ追加する最小変更アプローチ。

---

## Phase 1: Backend コピー (Agent Team で並列実行)

**agent-team-workflow skill**を使い、2つのサブエージェントで並列コピー。

### Agent A: market-lens-ai コピー

```bash
# コピー元: c:\Users\PEM N-266\work\market-lens-ai\
# コピー先: backends/market-lens-ai\

# 含めるもの:
mkdir -p backends/market-lens-ai
cp -r ../market-lens-ai/web/            backends/market-lens-ai/web/
cp -r ../market-lens-ai/alembic/        backends/market-lens-ai/alembic/
cp -r ../market-lens-ai/config/         backends/market-lens-ai/config/
cp -r ../market-lens-ai/tests/          backends/market-lens-ai/tests/
cp -r ../market-lens-ai/scripts/        backends/market-lens-ai/scripts/
cp -r ../market-lens-ai/docs/           backends/market-lens-ai/docs/
cp ../market-lens-ai/requirements.txt   backends/market-lens-ai/
cp ../market-lens-ai/requirements-dev.txt backends/market-lens-ai/
cp ../market-lens-ai/pytest.ini         backends/market-lens-ai/
cp ../market-lens-ai/alembic.ini        backends/market-lens-ai/
cp ../market-lens-ai/.env.example       backends/market-lens-ai/
cp ../market-lens-ai/.python-version    backends/market-lens-ai/ 2>/dev/null || true

# 除外: index.html, package.json, node_modules/, dist/, vite.config.ts,
#        vercel.json, .venv/, pages/, public/, stitch2/, tmp*/, data/scans/
```

### Agent B: ads-insights コピー

```bash
# コピー元: c:\Users\PEM N-266\work\ads-insights\
# コピー先: backends\ads-insights\

# 含めるもの:
mkdir -p backends/ads-insights/web/app
mkdir -p backends/ads-insights/bq

# web/app/ 内のPythonファイル (*.py) のみ — .bak.* は除外
cp ../ads-insights/web/__init__.py backends/ads-insights/web/ 2>/dev/null || true
find ../ads-insights/web/app -maxdepth 1 -name "*.py" ! -name "*.bak.*" \
  -exec cp {} backends/ads-insights/web/app/ \;

# data_providers ディレクトリ
cp -r ../ads-insights/web/app/data_providers backends/ads-insights/web/app/

# prompts ディレクトリ (web/app/prompts/ のみ)
cp -r ../ads-insights/web/app/prompts backends/ads-insights/web/app/ 2>/dev/null || true

# bq ディレクトリ
cp -r ../ads-insights/bq backends/ads-insights/

# ルートレベル (chart_generator.py はsys.path経由でimportされる)
cp ../ads-insights/chart_generator.py backends/ads-insights/

# 設定・テスト・スクリプト
cp -r ../ads-insights/tests backends/ads-insights/ 2>/dev/null || true
cp -r ../ads-insights/scripts backends/ads-insights/ 2>/dev/null || true
cp ../ads-insights/requirements.txt backends/ads-insights/
cp ../ads-insights/.env.example backends/ads-insights/ 2>/dev/null || true

# 除外: index.html, package.json, node_modules/, .venv/, *.bak.*,
#        web/app/ui/, web/app/components/, bq_reports/, compare/,
#        insights/, cases/, screenshots/, training_data/, *.key.json
```

**検証コマンド（各Agent内で実行）:**
```bash
# market-lens-ai
cd backends/market-lens-ai && python -c "from web.app.main import app; print('OK')"

# ads-insights
cd backends/ads-insights && python -c "from web.app.backend_api import app; print('OK')"
```

---

## Phase 2: 設定ファイル更新

### 2.1 `render.yaml` (新規)

```yaml
services:
  - type: web
    name: market-lens-staging
    runtime: python
    rootDir: backends/market-lens-ai
    buildCommand: pip install -r requirements.txt && alembic upgrade head
    startCommand: uvicorn web.app.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /api/health
    envVars:
      # 既存のrender.yamlから全envVarsをコピー（現状維持）
      # → セキュア値はsync: falseでRender Dashboard設定を引き継ぎ

  - type: web
    name: ads-insights-staging
    runtime: python
    rootDir: backends/ads-insights
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn web.app.backend_api:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 300
    healthCheckPath: /api/health
    envVars:
      # セキュア値はsync: false
```

**重要:** 既存のRenderサービスURLを維持するため、新しいサービスは作らず、既存サービスのRepo設定を変更する方針。

### 2.2 `vite.config.js` 変更

proxy targetをRender → localhostに変更（ローカル開発用。本番はvercel.jsonのrewriteが使われるので影響なし）:

```javascript
const proxy = {
  '/api/ml': {
    target: 'http://localhost:8002',     // ← 変更
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ml/, '/api'),
  },
  '/api/ads': {
    target: 'http://localhost:8001',     // ← 変更
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ads/, '/api'),
  },
}
```

### 2.3 `.gitignore` 追記

```gitignore
# === Python (backends) ===
__pycache__/
*.pyc
*.pyo
*.egg-info/
backends/*/.venv/
backends/*/venv/

# === Backend runtime data ===
backends/*/.pytest_cache/
backends/*/tmp*/
backends/*/data/

# === Backend secrets ===
backends/*/.env
backends/*/.env.local
*.key.json
*-key.json

# === Generated output ===
backends/ads-insights/bq_reports/
backends/ads-insights/compare/
backends/ads-insights/insights/
backends/ads-insights/cases/
```

### 2.4 `dev.ps1` (新規)

```powershell
# 全サービス一括起動スクリプト
# Frontend (port 3002) + ML backend (port 8002) + Ads backend (port 8001)

$repo = $PSScriptRoot

# Market Lens Backend
$ml = Start-Process python -ArgumentList "-m", "uvicorn", "web.app.main:app",
  "--host", "127.0.0.1", "--port", "8002", "--reload" `
  -WorkingDirectory "$repo\backends\market-lens-ai" -PassThru

# Ads Insights Backend
$ads = Start-Process python -ArgumentList "-m", "uvicorn", "web.app.backend_api:app",
  "--host", "127.0.0.1", "--port", "8001", "--reload", "--timeout-keep-alive", "300" `
  -WorkingDirectory "$repo\backends\ads-insights" -PassThru

# Frontend
npm run dev

# Cleanup
Stop-Process -Id $ml.Id, $ads.Id -ErrorAction SilentlyContinue
```

### 2.5 `CLAUDE.md` 更新

モノレポ構成・ローカル開発コマンド・テスト方法を追記。

---

## Phase 3: 検証 (Agent Team で並列)

### Agent A: Frontend検証
```bash
npm test          # 既存テストが通るか
npm run build     # ビルド成功するか
```

### Agent B: Backend検証
```bash
cd backends/market-lens-ai && python -m pytest    # テスト通るか
cd backends/ads-insights && python -c "from web.app.backend_api import app; print('OK')"
```

### Agent C: 統合検証
```bash
# dev.ps1 で全サービス起動 → curl でヘルスチェック
curl http://localhost:8002/api/health
curl http://localhost:8001/api/health
curl http://localhost:3002/  # フロントエンド
```

---

## Phase 4: Render デプロイ設定変更

**既存サービスの設定を変更（新規作成しない）:**

1. Render Dashboard → `market-lens-staging` → Settings:
   - Repository: `kazushi-tech/insight-studio` に変更
   - Root Directory: `backends/market-lens-ai` に設定
   - Build Command: `pip install -r requirements.txt && alembic upgrade head`
   - Start Command: `uvicorn web.app.main:app --host 0.0.0.0 --port $PORT`

2. Render Dashboard → `ads-insights-staging` → Settings:
   - Repository: `kazushi-tech/insight-studio` に変更
   - Root Directory: `backends/ads-insights` に設定
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn web.app.backend_api:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 300`

3. Manual Deploy → ヘルスチェック確認

4. フロントエンド（Vercel）は変更なし

---

## Phase 5: クリーンアップ

1. main にマージ
2. 旧リポジトリをArchive（Settings → Archive repository、削除はしない）
3. Vercel で本番動作確認

---

## Rollback Plan

- **Phase 1-3:** ブランチ削除だけで完全ロールバック
- **Phase 4:** Render Dashboard → Repository設定を旧リポに戻す → Manual Deploy
- **Phase 5:** `git revert`マージコミット

---

## Claude メリット（なぜこれをするか）

| Before | After |
|--------|-------|
| フロントエンドコードしか見えない | フロント+バックエンド全体が見える |
| 「フロントエンドが悪い」と誤診 | リクエストライフサイクル全体をトレース可能 |
| バックエンドのログを手動でコピペ | 同一コンテキストでエラー箇所を特定 |
| リポ跨ぎの修正に時間がかかる | 1リポで完結 |

---

## 実行時のAgent Team構成

```
Main Agent (orchestrator)
├── Agent A: market-lens-ai コピー + 検証
├── Agent B: ads-insights コピー + 検証
└── Agent C: 設定ファイル更新 + 統合テスト
```

`/agent-team-workflow` skill でtmuxセッション上で並列実行。
