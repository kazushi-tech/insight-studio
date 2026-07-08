# カメラの大林案件のBigQuery連携追加手順

## Context

新規案件「カメラの大林」を考察スタジオ（ads-insights）に追加する。大林のGA4/Google Ads BigQuery Export は既に独立GCPプロジェクト `camera-no-ohbayashi` に稼働中で、ペタビットマーケティング（`pem.advertisement2@gmail.com`）がオーナー権限を持つ。

**既存の仕組みでクロスプロジェクト参照が可能** — saurus_japan / hibarai と全く同じパターン（[plans/scalable-snacking-scott.md](plans/scalable-snacking-scott.md), [plans/handoff-2026-04-02-hibarai.md:70](plans/handoff-2026-04-02-hibarai.md#L70) 参照）。ads-insights のサービスアカウント `bq-reader@analyzedataplatform.iam.gserviceaccount.com` に `camera-no-ohbayashi` プロジェクト側の IAM で BQ 閲覧権限を付与し、cases.json に完全修飾形式の `dataset_id` を登録するだけで動く。**コード改修は不要**。

---

## 実施手順

### Step 1: GCP IAM 設定（`camera-no-ohbayashi` 側）

オーナー権限（pem.advertisement2）で作業:

1. GCP Console → `camera-no-ohbayashi` プロジェクト → BigQuery
2. 対象データセット（`analytics_287510881`）を開く
3. **共有** → **権限** → **プリンシパルを追加**
4. プリンシパル: `bq-reader@analyzedataplatform.iam.gserviceaccount.com`
5. ロール: **BigQuery データ閲覧者**
6. 保存
7. Google Ads データセット（`google_ads_raw`）も利用するなら同様に権限付与

> **ポイント:** プロジェクトレベルではなく **データセットレベル** で権限付与（最小権限の原則、既存案件と同じ運用）

### Step 2: データセットIDの確定

BQ Console で GA4 データセット名を確認 → 完全修飾形式で記録:
```
camera-no-ohbayashi.analytics_287510881
```

### Step 3: cases.json に案件エントリ追加

**ファイル:** [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json)

現状 POST /api/cases は未実装（[backend_api.py:2506](backends/ads-insights/web/app/backend_api.py#L2506) は GET のみ）ゆえ、JSON を直接編集してデプロイする運用。

追加するエントリ:
```json
{
  "case_id": "camera_ohbayashi",
  "name": "カメラの大林",
  "description": "カメラの大林 広告運用案件",
  "dataset_id": "camera-no-ohbayashi.analytics_287510881",
  "password_hash": "<bcrypt hashで生成>",
  "is_active": true,
  "is_internal": false
}
```

bcrypt ハッシュ生成（ローカル）:
```bash
cd backends/ads-insights
python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt(rounds=12)).decode())"
```
※ 平文パスワードはコミット禁止。クライアント共有は 1Password 等で。

### Step 4: （オプション）表示ラベル追加

**ファイル:** [backends/ads-insights/web/app/backend_api.py:14152-14154](backends/ads-insights/web/app/backend_api.py#L14152-L14154)

`/api/bq/datasets` の表示名をカスタマイズするなら追記:
```python
_DATASET_LABELS = {
    "analytics_311324674": "petabit.co.jp",
    "analytics_287510881": "カメラの大林",
}
```
未追加でも `GA4: analytics_287510881` と表示されるため必須ではない。

### Step 5: デプロイ

```bash
git checkout -b feat/add-camera-ohbayashi-case
git add backends/ads-insights/cases/cases.json
# （オプションで backend_api.py も）
git commit -m "feat(cases): add カメラの大林 case with cross-project BQ dataset"
git push -u origin feat/add-camera-ohbayashi-case
# PR作成 → merge → Render 自動デプロイ
```

---

## 動作検証

### ローカル検証
```bash
cd backends/ads-insights
uvicorn web.app.backend_api:app --port 8001 --reload
```

別タブで:
```bash
# ケース一覧に載っていること
curl http://localhost:8001/api/cases

# ログインで dataset_id が返ること
curl -X POST http://localhost:8001/api/cases/login \
  -H "Content-Type: application/json" \
  -d '{"case_id":"camera_ohbayashi","password":"YOUR_PASSWORD"}'
# 期待: "dataset_id": "camera-no-ohbayashi.analytics_287510881"

# 期間一覧が取得できること（ここでクロスプロジェクト参照が成功するか確認）
curl "http://localhost:8001/api/bq/periods?dataset_id=camera-no-ohbayashi.analytics_287510881&granularity=monthly"
# 期待: events_YYYYMMDD の suffix 一覧が返る
```

### 本番検証
1. insight-studio フロント `/projects`（admin）を開く
2. 「カメラの大林」が一覧に表示される
3. BQ接続テスト（`getCaseBqStatus`）で緑ステータス
4. ケースログイン → 考察スタジオでレポート生成 → 実データ表示確認

### BQ データ確認（直接）
```bash
bq --project_id=analyzedataplatform query --use_legacy_sql=false \
  'SELECT COUNT(*) FROM `camera-no-ohbayashi.analytics_287510881.__TABLES__` WHERE table_id LIKE "events_%"'
```
`analyzedataplatform` を実行プロジェクトに指定しつつ、`camera-no-ohbayashi` のデータにアクセスできるか確認。

---

## 変更対象ファイル一覧

| ファイル | 変更内容 | 必須/任意 |
|---------|----------|-----------|
| [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) | 新規エントリ1件追加 | 必須 |
| [backends/ads-insights/web/app/backend_api.py:14152](backends/ads-insights/web/app/backend_api.py#L14152) | `_DATASET_LABELS` にラベル追記 | 任意 |

**コード改修ゼロ**。既存のクロスプロジェクト参照パターンが完全にサポート済み。

---

## 既存の再利用コンポーネント・参考例

- [backends/ads-insights/bq/client.py:48](backends/ads-insights/bq/client.py#L48) — `run_query` はクライアントデフォルトプロジェクトで実行、SQL内で完全修飾データセット参照可能
- [backends/ads-insights/bq/auth.py](backends/ads-insights/bq/auth.py) — サービスアカウント認証（既存の `GOOGLE_CREDENTIALS_JSON` をそのまま流用）
- [backends/ads-insights/web/app/backend_api.py:2506-2586](backends/ads-insights/web/app/backend_api.py#L2506-L2586) — `/api/cases`, `/api/cases/login` 既存エンドポイント
- [src/pages/ProjectManagement.jsx:26](src/pages/ProjectManagement.jsx#L26) — 案件一覧表示（cases.json を自動反映）
- [src/components/CaseSelector.jsx:52-56](src/components/CaseSelector.jsx#L52-L56) — 案件選択UI（自動反映）

**同パターンの既存実装:**
- hibarai 案件（[plans/handoff-2026-04-02-hibarai.md](plans/handoff-2026-04-02-hibarai.md)）: `hibarai-ga4-bq.analytics_281420726`
- saurus_japan 案件（[plans/scalable-snacking-scott.md](plans/scalable-snacking-scott.md)）: `saurusjapan-analytics.analytics_287510881`

---

## 課金について

クロスプロジェクトクエリの課金は **クエリを実行するプロジェクト（`analyzedataplatform`）** に発生。`camera-no-ohbayashi` 側のデータ保管コストはプロジェクトオーナー側の負担のまま変わらず。大林側のサンドボックス表示は BQ **閲覧**用途では影響しない（課金アカウント紐付けは不要）。

---

## 注意事項・付記

- **ペタビット（pem2）アカウントで IAM 作業が必要**。自分のアカウントで pem.advertisement2 に権限がなければ、権限を持つ担当者に依頼。
- cases.json 直接編集のため、パスワード管理・ハッシュ生成は手作業になる。
- UI経由でのケース追加（POST /api/cases 実装）は将来タスク。
