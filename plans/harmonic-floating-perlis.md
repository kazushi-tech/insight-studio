# Fix: Render Build Failure — alembic running during build phase

## Context

PR #10 をマージ後、Render デプロイが "Exited with status 1 while building your code" で失敗し続けている（5時間）。

**ビルドログの決定的証拠:**
```
12:58:41 PM  CREATE TABLE assets (
12:58:41 PM      id VARCHAR(12) NOT NULL,
...
12:58:41 PM  (Background on this error at: https://sqlalche.me/e/20/f485)
12:58:41 PM  ==> Build failed
```

## 根本原因

### render.yaml が Render に無視されている

commit 0a0e46e で `render.yaml` の buildCommand から `alembic upgrade head` を除去し startCommand に移した。**しかし、Render のサービスはダッシュボードで手動作成されており、`render.yaml` を Blueprint として読んでいない。**

結果:
- ダッシュボードの buildCommand は古いまま: `pip install -r requirements.txt && alembic upgrade head`
- ビルド時に alembic が DB マイグレーション実行 → SQLAlchemy エラー (f485) → ビルド失敗

### 証拠
- ログに SQL DDL (`CREATE TABLE`) がビルドフェーズで出力されている
- render.yaml の buildCommand は `pip install -r requirements.txt`（alembic なし）に更新済み
- にもかかわらずビルドで alembic が走る = **render.yaml が使われていない**

## 修正方法

### Step 1: Render ダッシュボードで market-lens-ai サービス設定を手動更新

Render ダッシュボード → market-lens-ai サービス → Settings:

| 項目 | 現状（推定） | 修正後 |
|------|-------------|--------|
| **Root Directory** | `backends/market-lens-ai` | `backends/market-lens-ai`（変更なし） |
| **Build Command** | `pip install -r requirements.txt && alembic upgrade head` | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn web.app.main:app --host 0.0.0.0 --port $PORT` | `bash -c "alembic upgrade head && exec uvicorn web.app.main:app --host 0.0.0.0 --port $PORT"` |

**ポイント:** alembic はスタート時（DB接続可能な状態）に実行し、ビルド時には実行しない。

### Step 2: ads-insights サービスの runtime.txt 追加（コード変更）

`backends/ads-insights/runtime.txt` が存在しない。Render がデフォルト Python バージョンを使うため、予期しない互換性問題が起きうる。

```
# backends/ads-insights/runtime.txt (新規作成)
3.12.4
```

### Step 3 (推奨): Blueprint 化で render.yaml を実際に使う

長期的には Render Blueprint（Infrastructure as Code）として render.yaml を接続する。これにより、今後は render.yaml の変更がそのまま反映される。

Render ダッシュボード → Blueprints → New Blueprint Instance → GitHub リポジトリを接続 → render.yaml を指定。

**注意:** Blueprint 化すると既存の手動サービスとの重複に注意。既存サービスを削除してから Blueprint で再作成するか、既存サービスを Blueprint にインポートする。

## 対象ファイル

- `render.yaml` — 変更不要（既に正しい設定）
- `backends/ads-insights/runtime.txt` — **新規作成**（Step 2）
- Render ダッシュボード — **手動更新必須**（Step 1）

## 検証方法

1. Render ダッシュボードで buildCommand / startCommand を更新
2. Manual Deploy を実行（または新しいコミットをプッシュ）
3. ビルドログで `alembic` や `CREATE TABLE` がビルドフェーズに出ないことを確認
4. デプロイ成功後、ヘルスチェック `/api/health` が 200 を返すことを確認
5. Vercel 側からのプロキシ経由でバックエンドに到達できることを確認
