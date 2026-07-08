# GA4/BigQuery マルチクライアント連携 基盤構築計画

## Context

現在 Insight Studio はペタビット1社のGA4データのみ接続（`dataset_id: analytics_311324674` がハードコード）。
複数クライアントから連携要望があり、直近2〜3件対応が必要。

**現状の課題:**
- フロントのCase管理の骨格はあるが、BQ API呼び出しに反映されていない
- バックエンドの `GET /api/cases` はExcelフォルダスキャンのみ（`cases.json`を読んでいない）
- `cases.json` に `dataset_id` フィールドが無い
- Setup状態がグローバル（案件別スコープなし）

**活用できる既存資産:**
- BQエンドポイントは既に `dataset_id` パラメータを受け取れる（デフォルト値がペタビットなだけ）
- `bq/client.py` の `list_datasets()` で `analytics_*` データセット一覧取得可能
- `cross_source_map` API（folder→dataset_idマッピング）が既に存在
- フロントの `AdsSetupContext` に `getCurrentDatasetId()` / `selectCase()` / `authenticateCase()` が骨格として実装済み

---

## アーキテクチャ

```
Insight Studio (Frontend)
  CaseSelector → AdsSetupContext → API calls (dataset_id送信)
       ↓ /api/ads/*
ads-insights Backend (Render)
  Cases API (cases.json読み込み + CRUD) → BigQuery Client
       ↓
GCP: analyzedataplatform
  analytics_311324674 (ペタビット)
  analytics_XXXXXXXXX (クライアントB)
  analytics_YYYYYYYYY (クライアントC)
```

**GCP方針:** 1つのGCPプロジェクトに複数データセット集約。各クライアントのGA4からBQエクスポート設定し、サービスアカウントに閲覧権限付与。

---

## Phase 1: バックエンド — 案件管理API（ads-insights）

### 1-1. cases.json の拡張

`tmp_ads_insights_repo/cases/cases.json` に `dataset_id` と `password` を追加:

```json
[
  {
    "case_id": "petabit",
    "name": "ペタビット",
    "dataset_id": "analytics_311324674",
    "data_folder_hint": "ペタビット",
    "report_type": "ga4_bq",
    "password": "hashed_password",
    "status": "active",
    "created_at": "2025-01-01"
  },
  {
    "case_id": "clientB",
    "name": "クライアントA",
    "dataset_id": null,
    "data_folder_hint": "クライアントA",
    "report_type": "search_ads",
    "status": "active",
    "created_at": "2026-01-13"
  }
]
```

### 1-2. Cases API の書き直し

現在の `GET /api/cases` は `data/` ディレクトリのフォルダスキャンをしているだけ。
`cases.json` を読み込む方式に変更し、CRUD対応する。

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/cases` | 案件一覧（cases.json読み込み） |
| POST | `/api/cases` | 案件新規登録 |
| PUT | `/api/cases/:case_id` | 案件更新 |
| POST | `/api/cases/login` | 案件認証（拡充: dataset_idを返す） |
| GET | `/api/cases/:case_id/bq-status` | BigQuery接続テスト |

### 1-3. BQエンドポイント確認（変更不要の可能性大）

既に `dataset_id` パラメータを受け付けているので、変更は最小限:
- `GET /api/bq/periods` — ✅ 既に `dataset_id` クエリパラメータ対応
- `POST /api/bq/generate` — ✅ 既に `dataset_id` ボディパラメータ対応  
- `POST /api/bq/generate_batch` — ✅ 同上

**唯一必要な変更:** デフォルト値 `"analytics_311324674"` を削除し、`dataset_id` 必須化を検討（後方互換のため当面はデフォルト維持でも可）

### 対象ファイル（ads-insights リポ）
- `cases/cases.json` — 修正: dataset_id, password, status フィールド追加
- `web/app/backend_api.py` — 修正: `api_cases()` を cases.json 読み込みに変更、CRUD追加、`/cases/login` 拡充
- BQエンドポイント — 確認のみ（変更不要の見込み）

---

## Phase 2: フロントエンド — 配線修正（insight-studio）

### 2-1. API層の修正

`src/api/adsInsights.js`:
- `DEFAULT_ADS_DATASET_ID` をフォールバック専用に変更（export は維持するがAPI呼び出しでは使わない）
- `withDefaultDataset()` → 呼び出し元から明示的に `dataset_id` を渡す方式
- `bqPeriods(params)` のデフォルト dataset_id を除去
- `getCases()` のレスポンス形式を新APIに合わせる

### 2-2. AdsSetupContext の案件スコープ化

`src/contexts/AdsSetupContext.jsx`:
- localStorage キー: `insight-studio-ads-setup:${caseId}` に変更
- `loadState()` / `saveState()` が currentCase.case_id を参照
- 案件切替時: 旧案件のstateを保存 → 新案件のキャッシュを復元（あれば）
- マイグレーション: 既存の `insight-studio-ads-setup`（キーなし）はペタビットのデータとして扱う

### 2-3. SetupWizard の修正

`src/pages/SetupWizard.jsx`:
- `DEFAULT_ADS_DATASET_ID` の参照を全て `getCurrentDatasetId()` に置換（3箇所: L172, L186, L196）
- 案件未選択時はウィザード開始をブロック → 案件選択を促すUI

### 2-4. 下流ページの案件整合性チェック

reportBundle の `datasetId` と `currentCase.dataset_id` の一致を検証:
- `src/pages/Dashboard.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`

不一致時 → SetupWizardへリダイレクト

### 対象ファイル（insight-studio リポ）
- `src/api/adsInsights.js` — 修正
- `src/contexts/AdsSetupContext.jsx` — 修正
- `src/pages/SetupWizard.jsx` — 修正（3箇所のハードコード除去）
- `src/pages/Dashboard.jsx` — 修正（整合性チェック追加）
- `src/pages/EssentialPack.jsx` — 修正
- `src/pages/AnalysisGraphs.jsx` — 修正
- `src/pages/AiExplorer.jsx` — 修正
- `src/utils/adsReports.js` — 確認（dataset_id の受け渡し）

---

## Phase 3: フロントエンド — 案件管理UI

### 3-1. 案件管理ページ（新規）

`src/pages/CaseManagement.jsx`:
- 案件一覧テーブル（名前、dataset_id、ステータス、作成日）
- 新規案件登録フォーム（名前、case_id、dataset_id、パスワード）
- BigQuery接続テスト ボタン（`GET /api/cases/:case_id/bq-status`）
- 案件編集機能

### 3-2. CaseSelector の改善

`src/components/CaseSelector.jsx`:
- 案件のステータス表示（BQ接続済み / 未接続）
- 案件切替時の確認ダイアログ（進行中setup がある場合）

### 3-3. ルーティング・ナビ追加

- `src/App.jsx` — `/cases` ルート追加
- `src/components/Layout.jsx` — サイドバーに案件管理リンク

### 対象ファイル
- `src/pages/CaseManagement.jsx` — 新規作成
- `src/components/CaseSelector.jsx` — 修正
- `src/App.jsx` — 修正
- `src/components/Layout.jsx` — 修正

---

## Phase 4: GA4 → BigQuery オンボーディング

### 新規クライアント接続手順

1. **クライアントのGA4管理画面**: BigQueryリンク → `analyzedataplatform` プロジェクト選択 → エクスポート設定（日次）
2. **GCP Console**: サービスアカウントに新データセットの `BigQuery データ閲覧者` 権限付与
3. **Insight Studio 案件管理**: 新規Case登録（dataset_id = `analytics_新プロパティID`）→ 接続テスト
4. **運用開始**: CaseSelector で新案件選択 → SetupWizard → レポート閲覧

### 接続テスト機能

`GET /api/cases/:case_id/bq-status`:
- 指定 dataset_id で `__TABLES__` メタテーブルに簡易クエリ実行
- events_* テーブルの有無と最新日付を返す

---

## エージェントチーム構成

### Wave 1（並列）
| Agent | 担当 | 対象リポ |
|-------|------|---------|
| Agent A | Cases API 書き直し + cases.json拡張 | ads-insights |
| Agent B | API層 + AdsSetupContext 案件スコープ化 | insight-studio |

### Wave 2（Wave 1完了後、並列）
| Agent | 担当 | 対象リポ |
|-------|------|---------|
| Agent C | SetupWizard + 下流ページ修正 | insight-studio |
| Agent D | 案件管理UI (CaseManagement.jsx) | insight-studio |

### Wave 3（Wave 2完了後）
| Agent | 担当 | 対象リポ |
|-------|------|---------|
| Agent E | 統合テスト + 接続テストAPI | 両方 |

---

## 検証方法

### Phase 1（バックエンド）
- `GET /api/cases` が cases.json のデータを返す（dataset_id 含む）
- `POST /api/cases` で新規案件登録 → cases.json に追記される
- `POST /api/cases/login` で認証成功時に dataset_id を含むレスポンス
- `GET /api/cases/petabit/bq-status` で接続成功

### Phase 2（フロントエンド配線）
- Grep で `DEFAULT_ADS_DATASET_ID` のAPI呼び出し時使用が0件
- CaseSelector で案件選択 → SetupWizard が選択案件の dataset_id でBQクエリ
- 案件切替 → setup state リセット → 別案件のデータ表示
- localStorage に `insight-studio-ads-setup:petabit` 形式で保存

### Phase 3（案件管理UI）
- `/cases` ページで案件一覧 + 登録フォーム動作
- BQ接続テストボタン → ステータス表示

### リグレッション
- ペタビットで既存フロー（SetupWizard → EssentialPack → AnalysisGraphs）が正常動作
- 既存の localStorage データが壊れない（マイグレーション処理）

---

## リスクと注意点

1. **既存データ互換**: ペタビットのハードコード除去時、既存localStorage のマイグレーション必須
2. **バックエンドの保護ファイル**: `backend_api.py` は巨大（14000行超）。変更箇所を最小限に
3. **GCP権限**: 新データセットへのサービスアカウント権限付与は手動（自動化は将来課題）
4. **Renderデプロイ**: バックエンド変更後のデプロイ手順確認が必要
