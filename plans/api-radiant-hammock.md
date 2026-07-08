# ① 広告KPI取込 — Multi-Platform 対応プラン（完全無料）

> 前回 ② AI考察UI Stitch 2.0 リニューアルが完了したため、本プランで ① に着手する。
> **ハード制約**: 完全無料で運用すること（BQ 無料枠10GB + 1TB/月クエリ 内で収める）。
> **拡張要件**: Google Ads / Yahoo Ads / Meta / X / TikTok / LINE など**複数媒体**に将来対応できる構造。
> **第一歩**: Google Ads から開始（Meta は後回し）。

---

## Context

現状、`backends/ads-insights/` は **GA4 BigQuery Export のみ**を参照（[bq/queries.py](backends/ads-insights/bq/queries.py) の 9 テンプレートは全て `events_*` テーブル）。広告管理画面固有の KPI（impressions / CTR / CPC / CPA / ROAS など）は未対応。

ユーザー要件の重要ポイント:
- **弊社は複数媒体で広告運用中** → Google Ads だけ実装して Yahoo/Meta を別設計にする選択肢は取らない。最初からマルチプラットフォーム前提の**統一スキーマ**で設計する
- **料金無料** → BQDT(無料) + BigQuery 無料枠 + Cloud Functions 無料枠 の組み合わせで完全無料を維持
- 作業負荷は許容する → コンソール操作や GCP 設定の手間は問題なし

---

## 無料維持の内訳

| リソース | 無料枠 | 広告データ規模 | 判定 |
|----------|--------|---------------|------|
| BQDT 転送 | **完全無料**（永久） | — | ✅ |
| BigQuery Storage | 10GB/月無料 | 1案件 × 数媒体 × 365日 ≈ 数百MB | ✅ 余裕 |
| BigQuery Query | 1TB/月スキャン無料 | 広告クエリはMB単位 | ✅ 余裕 |
| Cloud Functions | 月200万実行・400K GB-sec 無料 | 日次取込 = 月30×媒体数回 | ✅ 余裕 |
| Cloud Scheduler | 月3ジョブ無料 | 媒体数が4を超えたら 1つに集約 | ⚠️ 要注意 |

→ **適切に設計すれば完全無料で運用可能**。

---

## Multi-Platform 対応の核心：統一スキーマ設計

媒体ごとにスキーマがバラバラだと、将来 UI 側が媒体別分岐だらけになる。そこで **normalized layer** を挟む:

```text
[Google Ads]     [Meta]       [Yahoo]      [X/TikTok/LINE]
  ↓ BQDT(無料)   ↓ BQDT(無料)  ↓ 自前ETL    ↓ 自前ETL
  ↓              ↓             ↓            ↓
[Raw dataset]  [Raw dataset] [Raw dataset] [Raw dataset]
  ads_google    ads_meta     ads_yahoo    ads_x ...
                 ↓
                 ↓ 日次スケジュールクエリ（無料）で
                 ↓ 全媒体を統一スキーマに正規化
                 ↓
              [Normalized dataset]
               ads_normalized.ads_daily
               (platform, date, campaign_id, campaign_name,
                impressions, clicks, cost_jpy, conversions, ...)
                 ↓
              [FastAPI → React]
```

### 統一スキーマ案 `ads_normalized.ads_daily`

```sql
-- 統一スキーマ（全媒体共通）
CREATE TABLE `analyzedataplatform.ads_normalized.ads_daily` (
  platform STRING NOT NULL,       -- 'google_ads' | 'meta' | 'yahoo' | 'x' | 'tiktok' | 'line'
  case_id STRING NOT NULL,        -- サウルスジャパン等
  date DATE NOT NULL,
  campaign_id STRING,
  campaign_name STRING,
  adgroup_id STRING,
  adgroup_name STRING,
  impressions INT64,
  clicks INT64,
  cost_jpy NUMERIC,               -- 円建てに統一（通貨換算は取込側で）
  conversions NUMERIC,
  conversion_value NUMERIC,
  ctr NUMERIC,                    -- computed: clicks/impressions
  cpc NUMERIC,                    -- computed: cost/clicks
  cpa NUMERIC,                    -- computed: cost/conversions
  roas NUMERIC,                   -- computed: conversion_value/cost
  raw_row STRING                  -- JSON文字列で元データ保持（デバッグ用）
)
PARTITION BY date
CLUSTER BY platform, case_id;
```

**この表だけで UI 側は全媒体統一で扱える** — `WHERE platform IN (...)` で媒体フィルタ、媒体横断集計も自在。

---

## 媒体別の取込戦略

| 媒体 | 取込方式 | 費用 | 実装工数 | 優先度 |
|------|---------|------|---------|--------|
| **Google Ads** | BQDT 公式コネクタ | 無料 | ゼロコード | 🥇 今回 Phase 0-1 |
| **Meta (Facebook/Instagram)** | BQDT 公式コネクタ | 無料 | ゼロコード | Phase 3（ユーザー「後回し」） |
| **Yahoo!広告** | Cloud Functions + Yahoo Ads API自前 | 無料枠内 | 中（数日） | Phase 4（重要・日本市場） |
| **X Ads** | Cloud Functions + X Ads API自前 | 無料枠内 | 中 | Phase 5 |
| **TikTok Ads** | Cloud Functions + TikTok Marketing API自前 | 無料枠内 | 中 | Phase 5 |
| **LINE広告** | Cloud Functions + LINE Ads Platform API自前 | 無料枠内 | 中 | Phase 5 |
| **代替手段（全媒体共通）** | CSV 手動アップロード | 無料 | 極小 | いつでも（バックアップ手段） |

**設計ポイント**: BQDT非対応媒体も「Raw dataset に吐き出す → 正規化クエリで統一スキーマに変換」という同じパターンに乗せる。これにより UI 側コードは媒体が増えても**一切変更不要**になる。

---

## Phase 0 — 今日やること（Day 1: Google Ads BQDT 動作確認）

**目的**: コード変更ゼロで「BQDT → BQ パイプライン」を1案件で通す。

### Step 1. BigQuery で空データセット作成（手動・5分）

[BQ コンソール](https://console.cloud.google.com/bigquery)の `analyzedataplatform` プロジェクトで:
- `ads_google_raw` データセット作成（ロケーション: asia-northeast1 推奨）
- `ads_normalized` データセット作成（同上）

### Step 2. BQDT で Google Ads 転送設定（手動・10-20分）

1. [BigQuery Data Transfer Service](https://console.cloud.google.com/bigquery/transfers) → 「転送を作成」
2. Source: **Google Ads**
3. Destination dataset: `ads_google_raw`
4. Google Ads MCC / クライアントアカウントに OAuth ログイン
5. Customer IDs: **試験対象1案件**（サウルスジャパン or カメラの大林 — 次のAsk で選ぶ）
6. スケジュール: 毎日 06:00 JST（既定OK）
7. 初回バックフィル: 過去30日

### Step 3. 初回転送完了を待つ（放置・数十分〜数時間）

転送詳細画面の「成功」ステータスを確認。`ads_google_raw` に `ads_Campaign_*`, `ads_Keyword_*`, `ads_Ad_*` などが生成される。

### Step 4. 統一スキーマへの正規化クエリを1本書く（15分）

BQ コンソールで以下を保存（スケジュール機能で日次実行・無料）:

```sql
-- ads_normalized.ads_daily への Google Ads データ挿入（日次）
MERGE `analyzedataplatform.ads_normalized.ads_daily` T
USING (
  SELECT
    'google_ads' AS platform,
    'saurus_japan' AS case_id,   -- Phase 1 で customer_id→case_id マッピング導入
    _DATA_DATE AS date,
    CAST(campaign_id AS STRING) AS campaign_id,
    campaign_name,
    CAST(ad_group_id AS STRING) AS adgroup_id,
    ad_group_name AS adgroup_name,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1e6 AS cost_jpy,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversion_value) AS conversion_value,
    SAFE_DIVIDE(SUM(metrics_clicks), SUM(metrics_impressions)) AS ctr,
    SAFE_DIVIDE(SUM(metrics_cost_micros) / 1e6, SUM(metrics_clicks)) AS cpc,
    SAFE_DIVIDE(SUM(metrics_cost_micros) / 1e6, SUM(metrics_conversions)) AS cpa,
    SAFE_DIVIDE(SUM(metrics_conversion_value), SUM(metrics_cost_micros) / 1e6) AS roas,
    TO_JSON_STRING(STRUCT(campaign_id, ad_group_id, metrics_impressions, metrics_clicks)) AS raw_row
  FROM `analyzedataplatform.ads_google_raw.ads_AdGroupStats_*`
  WHERE _DATA_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY date, campaign_id, campaign_name, ad_group_id, ad_group_name
) S
ON T.platform = S.platform AND T.case_id = S.case_id AND T.date = S.date
   AND T.campaign_id = S.campaign_id AND T.adgroup_id = S.adgroup_id
WHEN MATCHED THEN UPDATE SET
  impressions = S.impressions, clicks = S.clicks, cost_jpy = S.cost_jpy,
  conversions = S.conversions, conversion_value = S.conversion_value,
  ctr = S.ctr, cpc = S.cpc, cpa = S.cpa, roas = S.roas, raw_row = S.raw_row
WHEN NOT MATCHED THEN INSERT ROW;
```

**Day 1 完了条件**:
- [ ] `ads_google_raw` に BQDT 生成テーブルが存在
- [ ] 上記クエリが 0 行でない結果を `ads_normalized.ads_daily` に書き込む
- [ ] `SELECT * FROM ads_normalized.ads_daily WHERE platform='google_ads' LIMIT 10` でデータ確認

---

## Phase 1 — バックエンド統一スキーマ対応（Day 2-3）

### 1-1. 新ファイル: `backends/ads-insights/bq/ads_queries.py`

**全媒体横断クエリ**を提供する（`ads_normalized.ads_daily` 1本を見るだけ）:
- `ads_campaign_daily` — 日別キャンペーンパフォーマンス（platform 選択可）
- `ads_platform_summary` — 媒体横断サマリ（Google vs Yahoo vs Meta の比較）
- `ads_keyword_top` — Top Nキーワード（Google Ads のみ・raw から直接参照）
- `ads_adgroup_daily` — 日別広告グループ別

テンプレートは既存 [bq/queries.py](backends/ads-insights/bq/queries.py) と同じ `_build_query(template, dataset, start_date, end_date)` シグネチャを踏襲。

### 1-2. cases.json 拡張

[backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json):

```json
{
  "case_id": "saurus_japan",
  "dataset_id": "analytics_311324674",     // 既存: GA4
  "ads_platforms": {                         // 新規
    "google_ads": {
      "customer_ids": ["123-456-7890"],
      "enabled": true
    },
    "meta": { "enabled": false },
    "yahoo": { "enabled": false }
  }
}
```

### 1-3. エンドポイント拡張

[backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) の `/api/bq/generate_batch` に `query_type` 判定ロジック追加:
- `pv/traffic/cv/...` → GA4（既存、`bq/queries.py`）
- `ads_*` → 広告（新規、`bq/ads_queries.py`、`ads_normalized.ads_daily` を参照）

---

## Phase 2 — フロント統一UI対応（Day 4-5）

### 2-1. SetupWizard にクエリタイプ追加

[src/pages/SetupWizard.jsx:288-329](src/pages/SetupWizard.jsx#L288-L329) の Step 0 に「広告KPI」カテゴリ追加（4種）。
**媒体フィルタは含めない** — 「全媒体横断で見る」を既定。媒体絞りは Phase 2-2 で別UI。

### 2-2. 媒体フィルタ UI

レポート画面に「媒体」トグル（Google Ads / Meta / Yahoo / All）を追加。
`ads_normalized.ads_daily.platform` でWHERE絞り込み。

### 2-3. チャートジェネレータ拡張

[backends/ads-insights/chart_generator.py](backends/ads-insights/chart_generator.py) に広告KPI用チャート種別:
- impressions + clicks の2軸折れ線
- 媒体別 cost 積上げ棒
- CTR/CPC/CPA のトレンド
- ROAS ゲージ

---

## Phase 3 — 媒体追加（日毎に1媒体ずつ）

**Meta（BQDT公式対応・ゼロコード）**: Phase 0 と同じ手順を Meta で繰り返すだけ。所要時間30分〜1時間。

**Yahoo!広告（BQDT非対応・自前ETL）**:
1. Google Cloud Functions（Python）に Yahoo Ads API クライアント実装
2. Cloud Scheduler で日次トリガ（朝6:30 JST）
3. 取得データを `ads_yahoo_raw` に書き込み
4. 既存正規化クエリを拡張（`platform='yahoo'` 分岐追加）
5. 無料枠内（1日1回 × 数秒実行）

**X Ads / TikTok Ads / LINE Ads**: Yahoo と同じパターン。

→ **重要**: Phase 2 までで UI 側が `ads_normalized.ads_daily` 1本を見る設計になっておれば、**新媒体追加時にフロントは一切変更不要**。裏側の取込レイヤーだけ増える。

---

## Phase 4 — ATOM 相当のレポート自動生成・エクスポート（Day 10-14）

**目的**: 媒体横断の定型レポートを Excel/PDF で自動生成し、クライアント提出可能な品質に。ATOM との差別化ポイントは **AI考察サマリが自動で差し込まれる** こと。

### 4-1. レポートテンプレート定義

`backends/ads-insights/templates/ads_report/` 配下に以下を新設:

- `monthly_cross_platform.xlsx.j2` — 月次媒体横断レポート（Jinja2 + openpyxl）
- `weekly_single_platform.xlsx.j2` — 週次単一媒体レポート
- `executive_summary.md.j2` — AI考察サマリ用

**構成要素（ATOM 準拠）**:
1. **表紙** — 案件名・期間・媒体一覧
2. **エグゼクティブサマリ** — AI が自動生成した3〜5行の示唆（既存 AiExplorer の `/api/neon/generate` を再利用）
3. **KPIサマリ表** — 媒体別 impressions / clicks / CTR / CPC / CPA / ROAS
4. **トレンドグラフ** — 日別/週別の推移（chartGroups から埋め込み）
5. **媒体横断比較** — Google vs Yahoo vs Meta の同期間比較
6. **キャンペーン別詳細** — Top N キャンペーンの内訳
7. **AI詳細考察** — ATOM にない差別化ポイント

### 4-2. 既存資産の活用

| 必要機能 | 再利用元 |
|---------|---------|
| AI考察生成 | [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) `/api/neon/generate` |
| chartGroups 生成 | [backends/ads-insights/chart_generator.py](backends/ads-insights/chart_generator.py) |
| Excel 生成 | `openpyxl`（既に requirements.txt に存在） |
| PDF 生成 | `matplotlib` + `pypdf`（既存）or 新規 `reportlab` 追加 |
| レポートデータ集約 | [src/utils/adsReports.js](src/utils/adsReports.js) `buildAdsReportBundle` のロジックをPython移植 |

### 4-3. エンドポイント追加

```python
POST /api/ads/report/generate
{
  "case_id": "saurus_japan",
  "period": "2026-03",
  "platforms": ["google_ads", "yahoo", "meta"],
  "format": "xlsx" | "pdf" | "both",
  "template": "monthly_cross_platform"
}
→ レスポンス: ダウンロードURL（Cloud Storage 署名付きURL、無料枠内で24h有効）
```

### 4-4. フロント UI

AiExplorer 側に「レポート出力」ボタン追加:
- 媒体選択（全選択 or 個別）
- 期間選択（SetupWizard の期間選択UI 流用）
- フォーマット選択（Excel/PDF/両方）
- 生成 → ダウンロード

### 4-5. スケジュール配信（オプション）

Cloud Scheduler で月初自動生成し、指定メールアドレスに送付 → 運用フルオートメーション化。

**差別化要素（ATOM に対する優位性）**:

| 項目 | ATOM | Insight Studio Phase 4 |
|------|------|----------------------|
| 定型レポート生成 | ◎ | ◎ |
| Excel/PDF出力 | ◎ | ◎ |
| **AI考察の自動差し込み** | ✕ | ◎ |
| **レポートを AI に追加質問可能** | ✕ | ◎ |
| **媒体別の深掘り分析（AiExplorer 連動）** | △ | ◎ |
| カスタマイズ性 | △（テンプレ固定） | ◎（自社コード） |
| 月額費用 | あり | **無料** |

---

## 再利用する既存資産

| 用途 | ファイル | 備考 |
|------|----------|------|
| BQ クライアント | [bq/client.py](backends/ads-insights/bq/client.py) | `run_query()` そのまま使用 |
| BQ 認証 | [bq/auth.py](backends/ads-insights/bq/auth.py) | 同じサービスアカウントで BQDT + Cloud Functions 共用 |
| クエリテンプレート様式 | [bq/queries.py](backends/ads-insights/bq/queries.py) | `_build_query()` シグネチャ踏襲 |
| 案件管理 | [cases/cases.json](backends/ads-insights/cases/cases.json) | `ads_platforms` フィールド追加 |
| 期間選択UI | [src/pages/SetupWizard.jsx](src/pages/SetupWizard.jsx) Step 1 | 流用可 |
| レスポンス統合 | [src/utils/adsReports.js](src/utils/adsReports.js) `buildAdsReportBundle` | 新chartGroups自動マージ |

---

## 新規作成ファイル

- `backends/ads-insights/bq/ads_queries.py`（Phase 1-1）
- `backends/ads-insights/bq/ads_normalize.sql`（Phase 0 Step 4 の SQL を保存）
- `plans/api-radiant-hammock-yahoo.md`（Phase 4 着手時に別セッションで起票）

---

## Verification

### Phase 0 (今日)
- [ ] `ads_google_raw` に BQDT 生成テーブル（`ads_Campaign_*` 等）が存在
- [ ] `ads_normalized.ads_daily` に Google Ads データが入っている
- [ ] 疎通クエリ `SELECT platform, COUNT(*) FROM ads_normalized.ads_daily GROUP BY platform` で `google_ads` が出る
- [ ] GCP 課金ダッシュボードで $0.00 を確認（無料枠内）

### Phase 1 (Day 2-3)
- [ ] `cd backends/ads-insights && python -m pytest` 既存テスト全通過
- [ ] `curl 'http://localhost:8001/api/bq/generate_batch' -d '{"case_id":"saurus_japan","query_types":["ads_campaign_daily"],"periods":["2026-03"]}'` が 200 + chartGroups を返す

### Phase 2 (Day 4-5)
- [ ] `npm run build` 通過
- [ ] `webapp-testing` skill で SetupWizard → 広告KPI選択 → レポート → 媒体フィルタ操作 まで E2E 確認
- [ ] GA4 画面のリグレッションなし

---

## 意思決定が必要な事項

1. **Day 1 試験対象**: サウルスジャパン / カメラの大林 のどちら？（Google Ads 運用中の案件）
2. **BQ ロケーション**: `asia-northeast1`（東京）で良いか？GA4 既存データセットのロケーションと合わせるなら確認必要
3. **customer_id の管理**: cases.json に直書き vs 環境変数 vs 別ファイル（秘匿性考慮）
