# カメラの大林案件の追加手順（修正版）

## Context

新規案件「カメラの大林」を考察スタジオ（ads-insights）に追加する。GA4 BigQuery Export は独立GCPプロジェクト `camera-no-ohbayashi` に稼働済みで、ペタビットマーケティング（`pem.advertisement2@gmail.com`）がオーナー権限を持つ。

**既存の運用パターン（saurus_japan / hibarai と同じ）**:
- ads-insights のサービスアカウント `bq-reader@analyzedataplatform.iam.gserviceaccount.com` に、案件側GCPプロジェクトで BigQuery 権限を付与
- `cases.json` に完全修飾形式の `dataset_id` を登録
- クロスプロジェクトクエリで参照、課金は `analyzedataplatform` 側

**コード改修は不要**。cases.json 追加のみ。

---

## 既存計画書との差分（重要）

[plans/bigquery-serialized-whale.md](plans/bigquery-serialized-whale.md) に同じ目的のプランが存在するが、以下の点で情報が古い／誤っているため、**本プランで上書きする前提**:

| 項目 | 既存プラン（whale）の記述 | 実際の正しい値 | 根拠 |
|------|--------------------------|-----------------|------|
| dataset_id | `camera-no-ohbayashi.analytics_287510881` | `camera-no-ohbayashi.analytics_363548540` | 2026-04-18 BQ Console スクショで確認（`analytics_287510881` は `saurusjapan-analytics` プロジェクト配下の別物） |

---

## 実施手順

### Step 1: GCP IAM 設定（`camera-no-ohbayashi` 側）

オーナー権限（pem.advertisement2@gmail.com）で作業:

1. GCP Console → プロジェクト `camera-no-ohbayashi` → BigQuery
2. データセット `analytics_363548540` を開く
3. **共有 → 権限 → プリンシパルを追加**
4. プリンシパル: `bq-reader@analyzedataplatform.iam.gserviceaccount.com`
5. ロール（2つ付与）:
   - **BigQuery データ閲覧者**（データセット単位）
   - **BigQuery ジョブユーザー**（プロジェクト単位／IAMページから付与）
6. 保存
7. Google Ads データセット（`google_ads_raw` 等）も利用するなら同様に権限付与

> **運用根拠**: サウルスジャパンも同じ2ロール構成 — [plans/handoff-2026-04-07-saurus-japan-login.md:25](plans/handoff-2026-04-07-saurus-japan-login.md#L25)

### Step 2: パスワード決定 & bcrypt ハッシュ生成

サウルスジャパン（`Saurus2026`）と同じ命名パターンで、**暫定パスワード: `Obayashi2026`** で設定。お客さんに共有する前に希望があれば差し替える運用。

```bash
cd backends/ads-insights
python -c "import bcrypt; print(bcrypt.hashpw(b'Obayashi2026', bcrypt.gensalt(rounds=12)).decode())"
```

- 平文 `Obayashi2026` はコミット禁止（このプラン内に記載はOK、`cases.json` には **bcrypt ハッシュのみ** 入れる）
- 1Password 等で控えておく
- rounds=12 は既存案件と揃える（[cases.json:7](backends/ads-insights/cases/cases.json#L7) の `$2b$12$...` 参照）
- 本番リリース前にお客さんに相談し、必要なら再生成して差し替え

> **運用根拠**: サウルスジャパンも「暫定パスワード設定 → 動作確認 → お客さん共有」の流れ（[plans/handoff-2026-04-07-saurus-japan-login.md:37](plans/handoff-2026-04-07-saurus-japan-login.md#L37) 「サウルスジャパンのパスワードを `Saurus2026` に設定済み」）

### Step 3: cases.json に案件エントリ追加

**ファイル:** [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json)

末尾に以下を追加（JSON配列の最後の要素としてカンマに注意）:

```json
{
  "case_id": "camera_ohbayashi",
  "name": "カメラの大林",
  "description": "カメラの大林 広告運用案件",
  "dataset_id": "camera-no-ohbayashi.analytics_363548540",
  "password_hash": "<Step 2 で生成したハッシュ>",
  "is_active": true,
  "is_internal": false
}
```

**フィールドの意図**:
- `case_id`: 英数字・アンダースコア。URL/API で使う内部識別子
- `dataset_id`: 完全修飾形式 `project.dataset`（クロスプロジェクト参照に必要）
- `is_internal: false`: 顧客案件なので、admin 以外にも表示される

### Step 4: （任意）データセット表示ラベル追加

**ファイル:** [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) 付近の `_DATASET_LABELS` 定義

任意。未設定でも `GA4: analytics_363548540` と表示される。日本語ラベルを出したいなら追記。

### Step 5: ローカル動作検証

```bash
cd backends/ads-insights
uvicorn web.app.backend_api:app --port 8001 --reload
```

別タブで:
```bash
# 案件一覧に載ること
curl http://localhost:8001/api/cases

# ログイン成功と dataset_id が返ること
curl -X POST http://localhost:8001/api/cases/login \
  -H "Content-Type: application/json" \
  -d '{"case_id":"camera_ohbayashi","password":"YOUR_PASSWORD"}'
# 期待: "dataset_id": "camera-no-ohbayashi.analytics_363548540"

# BQ接続テスト（クロスプロジェクト参照の疎通確認）
TOKEN=<上のレスポンスの token>
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/api/cases/camera_ohbayashi/bq-status
# 期待: "ok": true, "connected": true, テーブル一覧が返る
```

### Step 6: デプロイ

```bash
git checkout -b feat/add-camera-ohbayashi-case
git add backends/ads-insights/cases/cases.json
git commit -m "feat(cases): add カメラの大林 case with cross-project BQ dataset"
git push -u origin feat/add-camera-ohbayashi-case
# GitHub で PR 作成 → merge → Render 自動デプロイ
```

---

## 本番検証

1. insight-studio フロント（Vercel）にログイン（admin）
2. `/projects` で「カメラの大林」が一覧に表示されること
3. BQ 接続ステータスが緑（`getCaseBqStatus`）
4. ログアウト → カメラの大林のパスワードで再ログイン → 広告考察画面に到達
5. 期間選択＆レポート生成で実データが取れること

---

## 変更対象ファイル

| ファイル | 変更内容 | 必須 |
|---------|----------|------|
| [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) | エントリ1件追加 | ✅ |
| [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) の `_DATASET_LABELS` | ラベル追記 | 任意 |

**コード改修ゼロ**。フロント（[CaseSelector.jsx:54-56](src/components/CaseSelector.jsx#L54-L56)、[ProjectManagement.jsx:26](src/pages/ProjectManagement.jsx#L26)）は cases.json を自動反映。

---

## 既存の再利用コンポーネント

- [backends/ads-insights/bq/client.py:22](backends/ads-insights/bq/client.py#L22) `get_client` — デフォルトプロジェクトは `analyzedataplatform`、SQL 側で完全修飾参照すればクロスプロジェクトOK
- [backends/ads-insights/bq/auth.py](backends/ads-insights/bq/auth.py) — `GOOGLE_CREDENTIALS_JSON`（Base64）でサービスアカウント認証。Render環境変数に設定済み
- [backends/ads-insights/web/app/backend_api.py:2506-2623](backends/ads-insights/web/app/backend_api.py#L2506-L2623) — `/api/cases`, `/api/cases/login`, `/api/cases/{id}/bq-status`

**同パターンの既存案件**:
- saurus_japan — [plans/handoff-2026-04-07-saurus-japan-login.md](plans/handoff-2026-04-07-saurus-japan-login.md)
- hibarai — [plans/handoff-2026-04-02-hibarai.md](plans/handoff-2026-04-02-hibarai.md)

---

## 注意事項

- **GCP 側の IAM 作業**（Step 1）は `pem.advertisement2@gmail.com` アカウント（オーナー）で実施する必要あり
- `cases.json` は直接編集＆ git コミット。UIからの新規案件追加（`POST /api/cases`）は未実装（[src/api/adsInsights.js:374-387](src/api/adsInsights.js#L374-L387) でクライアント関数だけ定義されており、バックエンド未対応）
- 平文パスワードの共有は 1Password 等セキュアなチャネルで
- `camera-no-ohbayashi` プロジェクトがサンドボックス表示でも、BQ **閲覧**用途は影響なし（課金は `analyzedataplatform` 側）
