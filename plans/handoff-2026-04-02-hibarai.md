# Handoff: hibarai 案件登録 & BQ権限問題（2026-04-02 午後）

## セッション概要

hibarai 案件を Insight Studio に登録し、BQ接続テストで権限エラーが発生。権限付与の方法を複数試みたが、いずれも失敗。フレワークさん（hibarai-ga4-bq のオーナー）への依頼が必要。

---

## 1. 完了済みタスク

### hibarai 案件を cases.json に追加

**コミット:** `d70765c` → `499fe8f`（dataset_id修正）
**プッシュ先:** `kazushi-tech/ads-insights` main ブランチ → Render 自動デプロイ済み

```json
{
    "case_id": "hibarai",
    "name": "hibarai",
    "description": "hibarai広告分析",
    "dataset_id": "hibarai-ga4-bq.analytics_281420726",
    "password_hash": "$2b$12$.2MlhofrLaPtLgD0iyc3mucLycBqMoHvtmIJUNumCBrbQ1MDiEpAO",
    "is_active": true,
    "data_folder_hint": "hibarai",
    "report_type": "search_ads",
    "created_at": "2026-04-02T00:00:00"
}
```

**パスワード:** 他案件と同じ共通パスワード（`aQWkTCzrYF6b4xiV3=na19ID`）

### BQクエリでクライアント特定

```sql
SELECT device.web_info.hostname, COUNT(*) as cnt
FROM `hibarai-ga4-bq.analytics_281420726.events_*`
WHERE _TABLE_SUFFIX >= '20260301'
GROUP BY 1 ORDER BY 2 DESC LIMIT 5
```

結果: メインドメインは `www.hibarai.com`（106万件）

### API 動作確認

`GET /api/cases` で hibarai が正しく返却されることを確認済み。
Insight Studio の案件管理ページにも表示されている。

---

## 2. 未解決: BQ接続テストの権限エラー

### エラー内容

```
403 Access Denied: Table hibarai-ga4-bq:analytics_281420726.__TABLES__: 
User does not have permission to query table hibarai-ga4-bq:analytics_281420726.__TABLES__
```

### 原因

Render バックエンドが使うサービスアカウントに `hibarai-ga4-bq` プロジェクトへのアクセス権がない。

| アカウント | hibarai-ga4-bq へのアクセス |
|-----------|--------------------------|
| `pem.advertisement@gmail.com`（人間・共有アカウント） | ✅ あり（BigQuery データ閲覧者 + 編集者） |
| `bq-reader@analyzedataplatform.iam.gserviceaccount.com`（Renderのサービスアカウント） | ❌ なし |

### ペタビットが動く理由

ペタビットの `analytics_311324674` は `pem-ga4` プロジェクトにあり、サービスアカウントはそちらにはアクセス権がある。hibarai は別プロジェクト（`hibarai-ga4-bq`）にあるため、別途権限が必要。

### 試みた方法と結果

| 方法 | 結果 | 理由 |
|------|------|------|
| GCP IAM → hibarai-ga4-bq → アクセスを許可 | ❌ 権限不足 | `pem.advertisement@gmail.com` は編集者だがオーナーではない。`resourcemanager.projects.setIamPolicy` が必要 |
| BigQuery → analytics_281420726 → 共有 → 権限を管理 | ❌ 権限不足 | 「選択したリソースの権限を編集する権限がありません」と表示 |
| BigQuery SQL で GRANT 文実行 | ❌ 権限不足 | `bigquery.datasets.update denied on dataset hibarai-ga4-bq:analytics_281420726` |
| Cloud Shell から bq コマンド | ❌ 未実行 | Cloud Shell アイコンが表示されなかった（サンドボックスモードの可能性） |

### 結論

**`hibarai-ga4-bq` のオーナーに依頼する必要がある。**

---

## 3. hibarai-ga4-bq プロジェクトの権限構成

| アカウント | ロール |
|-----------|-------|
| `firebase-measurement@system.gserviceaccount.com` | 閲覧者、BigQuery ユーザー、ログ書き込み |
| `flework.inc@gmail.com` | **オーナー** |
| `millertime.31.tm@gmail.com` | **オーナー** |
| `pem.advertisement@gmail.com`（鬼頭 健） | BigQuery ジョブユーザー、BigQuery データ閲覧者、編集者 |
| `ca9951808@gmail.com` | 閲覧者 |

### データセットレベルの権限（analytics_281420726）

| ロール | アカウント |
|-------|-----------|
| BigQuery データオーナー (2) | firebase-measurement@system.gserviceaccount.com、プロジェクトオーナー |
| BigQuery データ閲覧者 (2) | pem.advertisement@gmail.com、プロジェクト閲覧者 |
| BigQuery データ編集者 (1) | プロジェクト編集者 |
| BigQuery ユーザー (1) | firebase-measurement@system.gserviceaccount.com |
| オーナー (2) | flework.inc@gmail.com、millertime.31.tm@gmail.com |
| 閲覧者 (1) | ca9951808@gmail.com |
| 編集者 (1) | pem.advertisement@gmail.com |

---

## 4. 次のアクション（1つだけ）

### フレワークさんに依頼

`flework.inc@gmail.com`（hibarai-ga4-bq のオーナー）に以下を依頼する:

> hibarai-ga4-bq の BigQuery データセット `analytics_281420726` に
> 以下のサービスアカウントの閲覧権限を追加してください。
>
> **アカウント:** `bq-reader@analyzedataplatform.iam.gserviceaccount.com`
> **ロール:** BigQuery データ閲覧者（BigQuery Data Viewer）
>
> **設定方法（どちらか）:**
> - プロジェクトレベル: GCP → hibarai-ga4-bq → IAM → アクセスを許可
> - データセットレベル: BigQuery → analytics_281420726 → 共有 → 権限を管理 → プリンシパルを追加

**注意:** `pem.advertisement@gmail.com` は編集者ロールだが、IAM変更権限（setIamPolicy / datasets.update）が付与されていないため、PEM側では設定不可。鬼頭さん経由でフレワークさんに依頼するか、フレワークさんに直接連絡する必要がある。

### 権限付与後の確認手順

1. Insight Studio（insight-studio-chi.vercel.app/cases）で hibarai の「テスト」ボタンをクリック
2. 「Connected: true」と表示されれば成功

---

## 5. Render サービスアカウント情報

| 項目 | 値 |
|------|-----|
| メール | `bq-reader@analyzedataplatform.iam.gserviceaccount.com` |
| 所属プロジェクト | `analyzedataplatform` |
| Render 環境変数 | `GOOGLE_CREDENTIALS_JSON`（Base64エンコード） |
| client_id | `115630663913120599833` |

---

## 6. 現在の cases.json の状態

```json
[
    {
        "case_id": "test_case",
        "name": "テスト案件",
        "description": "動作確認用テスト案件",
        "dataset_id": "analytics_311324674",
        "password_hash": "$2b$12$.2MlhofrLaPtLgD0iyc3mucLycBqMoHvtmIJUNumCBrbQ1MDiEpAO",
        "is_active": true,
        "data_folder_hint": "テスト案件",
        "report_type": "search_ads",
        "created_at": "2026-04-02T00:00:00"
    },
    {
        "case_id": "petabit",
        "name": "ペタビット",
        "description": "ペタビット広告分析",
        "dataset_id": "analytics_311324674",
        "password_hash": "$2b$12$.2MlhofrLaPtLgD0iyc3mucLycBqMoHvtmIJUNumCBrbQ1MDiEpAO",
        "is_active": true,
        "data_folder_hint": "ペタビット",
        "report_type": "search_ads",
        "created_at": "2026-04-02T00:00:00"
    },
    {
        "case_id": "hibarai",
        "name": "hibarai",
        "description": "hibarai広告分析",
        "dataset_id": "hibarai-ga4-bq.analytics_281420726",
        "password_hash": "$2b$12$.2MlhofrLaPtLgD0iyc3mucLycBqMoHvtmIJUNumCBrbQ1MDiEpAO",
        "is_active": true,
        "data_folder_hint": "hibarai",
        "report_type": "search_ads",
        "created_at": "2026-04-02T00:00:00"
    }
]
```

---

## 7. 関連ファイル

### バックエンド（ads-insights リポ: `tmp_ads_insights_repo/`）
- `cases/cases.json` — 案件マスターデータ（hibarai追加済み）
- `web/app/backend_api.py:2681-2692` — BQ接続テストエンドポイント
- `bq/client.py` — BQクライアント（`PROJECT_ID = "analyzedataplatform"`）
- `bq/auth.py` — BQ認証ヘルパー（GOOGLE_CREDENTIALS_JSON デコード）

### フロントエンド（insight-studio リポ）
- `src/pages/CaseManagement.jsx` — 案件管理ページ（hibarai表示確認済み）

### デプロイ
- **フロントエンド:** Vercel（insight-studio-chi.vercel.app）
- **バックエンド:** Render（ads-insights-9q5s.onrender.com）— コミット `499fe8f` デプロイ済み

### プラン
- `plans/iridescent-stirring-glade.md` — 本タスクのプラン（案件登録部分は完了）
- `plans/handoff-2026-04-02.md` — 前セッションの handoff（GCP調査結果含む）
