# Plan: hibarai 案件を Insight Studio に登録

## Context

BigQuery クエリで `hibarai-ga4-bq.analytics_281420726` のメインドメインが `www.hibarai.com` と判明。
上司確認済みで `pem-ga4` からアクセス可能。即登録可能な状態。

## Steps

### Step 1: cases.json に hibarai エントリを追加

**ファイル:** `tmp_ads_insights_repo/cases/cases.json`

既存エントリと同じ構造で以下を追加：

```json
{
    "case_id": "hibarai",
    "name": "hibarai",
    "description": "hibarai広告分析",
    "dataset_id": "analytics_281420726",
    "password_hash": "$2b$12$.2MlhofrLaPtLgD0iyc3mucLycBqMoHvtmIJUNumCBrbQ1MDiEpAO",
    "is_active": true,
    "data_folder_hint": "hibarai",
    "report_type": "search_ads",
    "created_at": "2026-04-02T00:00:00"
}
```

- `password_hash` は既存案件と同じ共通パスワード（`aQWkTCzrYF6b4xiV3=na19ID`）のハッシュを再利用
- `dataset_id` は `analytics_281420726`（hibarai-ga4-bq プロジェクト）

### Step 2: バックエンドリポにコミット & プッシュ

```bash
cd tmp_ads_insights_repo
git add cases/cases.json
git commit -m "feat: add hibarai case (dataset: analytics_281420726)"
git push origin main
```

→ Render（ads-insights-9q5s.onrender.com）が自動デプロイ

### Step 3: デプロイ確認

Render デプロイ完了後、API で hibarai が返ることを確認：

```bash
curl https://ads-insights-9q5s.onrender.com/api/cases
```

レスポンスに `hibarai` エントリが含まれていれば成功。

## Verification

1. `GET /api/cases` に hibarai が表示される
2. Insight Studio の案件管理ページで hibarai が選択可能
3. 案件ログイン（共通パスワード）→ Dataset ID `analytics_281420726` が表示される
