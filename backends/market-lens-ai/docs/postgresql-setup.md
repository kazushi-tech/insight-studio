# PostgreSQL Setup Guide — Market Lens AI

Render 上で PostgreSQL を使用するための手順。

## 1. Render PostgreSQL アドオン追加

1. Render ダッシュボードで **New > PostgreSQL** を選択
2. 設定:
   - **Name**: `market-lens-db`
   - **Region**: サービスと同じリージョン（例: Oregon）
   - **Plan**: Free（開発用）または Starter（本番用）
3. **Create Database** をクリック

## 2. DATABASE_URL の設定

PostgreSQL 作成後、Render が `Internal Database URL` を発行する。

1. Render ダッシュボードで PostgreSQL インスタンスの **Info** タブを開く
2. **Internal Database URL** をコピー
3. Market Lens API サービスの **Environment** タブで `DATABASE_URL` に貼り付け

> **注意**: Render の Internal URL は `postgres://...` 形式だが、SQLAlchemy は `postgresql://` を要求する。
> Render は自動的に `DATABASE_URL` を正しい形式で注入するが、手動設定の場合は
> `postgres://` を `postgresql://` に置換すること。

```
# Render Internal URL (例)
postgres://user:pass@host:5432/market_lens_db

# SQLAlchemy 用に修正
postgresql://user:pass@host:5432/market_lens_db
```

## 3. Alembic マイグレーション実行

Render のデプロイ時に自動実行する場合、`render.yaml` の `buildCommand` を更新する:

```yaml
buildCommand: pip install -r requirements.txt && alembic upgrade head
```

手動で実行する場合:

```bash
# DATABASE_URL を設定済みの環境で実行
alembic upgrade head
```

### マイグレーション一覧

| Revision | 内容 |
|----------|------|
| 001 | 初期テーブル（assets, asset_data, review_runs, review_outputs, export_records） |
| 002 | Discovery テーブル（discovery_searches, discovery_candidates） |
| 003 | Library テーブル（library_items） |
| 004 | Monitoring テーブル（watchlist_entries, digest_reports） |
| 005 | Generation テーブル（generated_assets） |

### マイグレーション状態の確認

```bash
alembic current   # 現在のリビジョン
alembic history   # 全マイグレーション履歴
```

## 4. REPOSITORY_BACKEND の切替

環境変数 `REPOSITORY_BACKEND` を `db` に設定する:

```
REPOSITORY_BACKEND=db
```

- `file` (デフォルト): ファイルベース保存 (`data/scans/`)
- `db`: PostgreSQL / SQLite を使用

`render.yaml` では既に `db` がデフォルト値として設定済み。

## 5. ローカル開発での PostgreSQL 使用

ローカルで PostgreSQL を使う場合:

```bash
# .env.local に設定
DATABASE_URL=postgresql://localhost:5432/market_lens_dev
REPOSITORY_BACKEND=db

# テーブル作成
alembic upgrade head
```

SQLite で DB モードを試す場合（PostgreSQL 不要）:

```bash
# .env.local に設定
DATABASE_URL=sqlite:///data/market_lens.db
REPOSITORY_BACKEND=db

# テーブル作成
alembic upgrade head
```

## 6. トラブルシューティング

### alembic upgrade が失敗する

```bash
# 現在のリビジョンを確認
alembic current

# 特定のリビジョンまで戻す
alembic downgrade 003

# 再度適用
alembic upgrade head
```

### テーブルが見つからない

DB モード (`REPOSITORY_BACKEND=db`) で起動する前に `alembic upgrade head` を実行したか確認する。
エンジンの `create_tables()` は開発用であり、本番では Alembic を使用すること。
