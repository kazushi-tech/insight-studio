# サウルスジャパン BigQuery連携計画

## Context

pem2アカウントのGCPプロジェクト`saurusjapan-analytics`にGA4→BigQueryエクスポートが設定済み。
これをInsight Studioから参照し、サウルスジャパン（クライアント）は自案件のみ、PEMチーム（admin）は全案件を閲覧できる状態にする。

**結論：pem側のGCPにBigQueryデータを移す必要はない。** クロスプロジェクトアクセス（IAM権限付与）で対応可能。既に`hibarai`案件で同じパターンが稼働中。

## 前提（既存の仕組み）

- ads-insightsバックエンドのサービスアカウントがBigQueryにアクセス
- 各案件(case)に`dataset_id`フィールドがあり、`プロジェクトID.データセット名`形式でクロスプロジェクト参照が可能
- 例: `hibarai-ga4-bq.analytics_281420726`（hibarai案件の実績）
- SQLテンプレートが`` `{dataset}.events_*` ``で展開 → BigQueryが自動解決
- RBACで`client`ロールは`projectIds`配列内の案件のみアクセス可能

## 実施手順

### Step 1: GCP IAM設定（pem2のコンソールで実施）

1. ads-insightsバックエンドの`GOOGLE_CREDENTIALS_JSON`からサービスアカウントのメールアドレスを取得（`client_email`フィールド）
2. **saurusjapan-analytics**プロジェクトのBigQueryコンソールで：
   - GA4エクスポートデータセット（`analytics_XXXXXXXXX`）を選択
   - **共有** → **権限** → サービスアカウントに`BigQuery データ閲覧者`ロールを付与

> **ポイント**: プロジェクトレベルではなくデータセットレベルで権限付与（最小権限の原則）

### Step 2: データセットIDの確認

pem2のBigQueryコンソールで、`saurusjapan-analytics`プロジェクト内のGA4データセット名を確認。
→ `saurusjapan-analytics.analytics_XXXXXXXXX` がdataset_idになる

### Step 3: 案件(case)の追加

ads-insightsバックエンドの`cases/cases.json`に追加：
```json
{
  "case_id": "saurus_japan",
  "name": "サウルスジャパン",
  "description": "サウルスジャパン GA4分析",
  "dataset_id": "saurusjapan-analytics.analytics_287510881",
  "is_active": true
}
```

### Step 4: クライアントユーザーの作成

Vercelの`AUTH_USERS`環境変数にクライアントユーザーを追加：
```json
{
  "user_id": "saurus_client",
  "email": "（サウルスジャパン担当者のメール）",
  "password_hash": "（SHA256ハッシュ）",
  "role": "client",
  "display_name": "サウルスジャパン",
  "project_ids": ["saurus_japan"]
}
```
- `client`ロールなので`saurus_japan`案件のみ閲覧可能
- adminユーザー（PEMチーム）は変更不要 — 全案件が自動的に見える

### Step 5: 接続テスト

Insight Studioのプロジェクト管理画面からBQ接続テスト実行（既存機能）

## 発見されたバグ：プロジェクト更新時の自動ログアウト

**原因:** RBAC（メールログイン）のJWTトークンとads-insightsバックエンドのオペークトークンが互換性なし。
プロジェクト編集のPUT `/api/cases/{caseId}` がJWTを拒否 → 401 → 自動ログアウト。

**関連ファイル:**
- `src/api/adsInsights.js` (L96-109): 401でonAuthError発火
- `src/contexts/AuthContext.jsx` (L120-126): onAuthErrorでlogoutAds()
- `tmp_ads_insights_repo/web/app/backend_api.py` (L1262-1269): _validate_token()がJWT非対応

**修正方針:** バックエンドのミドルウェアでJWT検証も追加する（別タスク）

## 即時対応：cases.jsonのdataset_id更新

UI経由の更新がバグで使えないため、`cases/cases.json`の`saurus_japan`エントリの`dataset_id`を直接修正してデプロイする。

```json
"dataset_id": "saurusjapan-analytics.analytics_287510881"
```

## 後続タスク：バックエンドのJWT対応

バックエンドの認証ミドルウェアを修正して、RBACのJWTトークンでもAPIが使えるようにする。

## クエリ課金について

クロスプロジェクトクエリの課金は**クエリを実行するプロジェクト**（pem側の`analyzedataplatform`）に発生。データ保管先（`saurusjapan-analytics`）には課金されない。

## 事前準備：サービスアカウント ✅ 確認済み

**サービスアカウント:** `bq-reader@analyzedataplatform.iam.gserviceaccount.com`

## 事前準備：データセットID ✅ 確認済み

**データセットID:** `saurusjapan-analytics.analytics_287510881`

## クライアントアカウントについて

後日決定。当面はPEMチーム（admin）のみで運用し、サウルスジャパン側にログインを提供するタイミングでclientユーザーを`AUTH_USERS`に追加する。
