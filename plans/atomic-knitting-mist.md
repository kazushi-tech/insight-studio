# レビュー結果: GA4/BigQuery マルチクライアント連携計画 (mutable-cuddling-meadow.md)

## レビューサマリー

元プランの技術的主張はコードベースと照合済み、**ほぼ正確**。
ただし以下の **Critical 3件 / Major 4件 / Minor 3件** の問題を発見。修正版を以下に記す。

---

## 発見した問題一覧

| # | 重度 | 問題 | 影響 |
|---|------|------|------|
| 1 | **Critical** | `withDefaultDataset()` が全BQ API呼び出しに注入 — SetupWizard 3箇所だけでは不十分 | dataset_id差し替え漏れ → 他案件でもペタビットのデータを取得 |
| 2 | **Critical** | `adsReports.js` を「確認のみ」としているが L200, L245 に `DEFAULT_ADS_DATASET_ID` フォールバックあり | reportBundle に誤った dataset_id 混入 |
| 3 | **Critical** | `SetupGuard` が案件認証・dataset_id整合性を未チェック | 未認証/別案件のデータに直接アクセス可能 |
| 4 | **Major** | `CaseAuthModal.jsx` への言及なし（既存の認証UIインフラ） | 不要な重複実装リスク |
| 5 | **Major** | クロスリポ戦略が未定義（ads-insights変更のデプロイ手順） | 実装後にデプロイ不能 |
| 6 | **Major** | Agent Wave構造が非効率 — CaseManagement.jsx は依存なしなのにWave 2 | 並列度が低く実装時間が増大 |
| 7 | **Major** | localStorage マイグレーションの詳細不足 | 既存ユーザーのsetupデータ消失 |
| 8 | Minor | `bqPeriods()` 呼び出し（SetupWizard L99）が dataset_id 未送信 | ペタビット以外で期間取得失敗 |
| 9 | Minor | ロールバック戦略なし | 障害時の復旧手順不明 |
| 10 | Minor | 下流ページ（EssentialPack等）は直接修正不要 — reportBundle 経由で解決 | 不要な作業スコープ |

---

## 修正版プラン

### Context

Insight Studio は現在ペタビット1社のGA4データのみ接続（`analytics_311324674` ハードコード）。
複数クライアント対応のため、案件ごとに `dataset_id` を切り替える基盤を構築する。

**根本原因:** `src/api/adsInsights.js` の `withDefaultDataset()` が全BQ API呼び出しにペタビットの dataset_id をデフォルト注入。これを案件コンテキストから動的取得に変更する。

---

### Phase 1: バックエンド — 案件管理API（ads-insights）

#### 1-1. `cases.json` 拡張

**ファイル:** `tmp_ads_insights_repo/cases/cases.json`

追加フィールド: `dataset_id`（nullable）, `password`（bcrypt hash, nullable）, `status`（active/inactive）
ペタビットエントリを追加: `dataset_id: "analytics_311324674"`

#### 1-2. Cases API 書き直し + 新エンドポイント

**ファイル:** `tmp_ads_insights_repo/web/app/backend_api.py`

| Method | Path | 用途 | 備考 |
|--------|------|------|------|
| GET | `/api/cases` | 案件一覧（cases.json読み込み） | L2490 の既存 `api_cases()` を書き直し |
| POST | `/api/cases` | 案件新規登録 | 新規 |
| PUT | `/api/cases/:case_id` | 案件更新 | 新規 |
| POST | `/api/cases/login` | 案件認証 → dataset_id返却 | 新規。**L1269 `_AUTH_PUBLIC_PATHS` に追加必須** |
| GET | `/api/cases/:case_id/bq-status` | BigQuery接続テスト | 新規 |

#### 1-3. BQエンドポイント — 変更不要

`bq/periods`, `bq/generate`, `bq/generate_batch` は既に `dataset_id` パラメータ対応済み。デフォルト値は後方互換のため維持。

#### 対象ファイル
- `tmp_ads_insights_repo/cases/cases.json` — 修正
- `tmp_ads_insights_repo/web/app/backend_api.py` — 修正（L2490 `api_cases()` 書き直し + 3新規エンドポイント + L1269 `_AUTH_PUBLIC_PATHS`）

---

### Phase 2: フロントエンド — コア配線修正（insight-studio）

#### 2-1. `withDefaultDataset()` の廃止 ★最重要

**ファイル:** `src/api/adsInsights.js`

- `withDefaultDataset()` (L114-116) を削除
- 以下の関数から暗黙のデフォルト注入を除去、呼び出し元が `dataset_id` を明示的に渡す方式に変更:
  - `loadData()` (L161)
  - `generateInsights()` (L169)
  - `bqGenerate()` (L241)
  - `bqGenerateBatch()` (L249)
  - `bqPeriods()` (L234) — インラインマージも除去
- `DEFAULT_ADS_DATASET_ID` (L2) のexportは維持（`getCurrentDatasetId()` のフォールバック用）

#### 2-2. `adsReports.js` のフォールバック除去 ★元プランで見落とし

**ファイル:** `src/utils/adsReports.js`

- `buildAdsReportBundle()` (L200): `DEFAULT_ADS_DATASET_ID` フォールバック → `setupState.datasetId` 必須化
- `regenerateAdsReportBundle()` (L245): 同上
- `generateBatchWithRetry()` が呼ぶ `bqGenerateBatch()` に `dataset_id` を呼び出し元から受け渡す

#### 2-3. `AdsSetupContext` の案件スコープ化

**ファイル:** `src/contexts/AdsSetupContext.jsx`

**ストレージキー変更:**
- `loadState(caseId)` / `saveState(state, caseId)` がスコープ付きキーを使用
- キー形式: `insight-studio-ads-setup:${caseId}`
- `completeSetup()` (L155): `DEFAULT_ADS_DATASET_ID` → `getCurrentDatasetId()` に変更

**マイグレーション処理（Critical）:**
1. マウント時、レガシーキー `insight-studio-ads-setup`（サフィックスなし）の存在チェック
2. 存在する場合: パース → `insight-studio-ads-setup:petabit` に書き込み → レガシーキー削除
3. `currentCase` 未設定の場合、自動的にペタビットをセット
4. `STORAGE_VERSION = 3` とクエリタイプマイグレーション（L10-15）はそのまま動作（キー変更はデータ形式と直交）

#### 2-4. SetupWizard のハードコード除去

**ファイル:** `src/pages/SetupWizard.jsx`

- L173: `dataset_id: DEFAULT_ADS_DATASET_ID` → `dataset_id: getCurrentDatasetId()`
- L186: `datasetId: DEFAULT_ADS_DATASET_ID` → `datasetId: getCurrentDatasetId()`
- L196: `datasetId: DEFAULT_ADS_DATASET_ID` → `datasetId: getCurrentDatasetId()`
- L99: `bqPeriods()` 呼び出しに `dataset_id: getCurrentDatasetId()` を追加（**元プランで見落とし**）
- `useAdsSetup()` から `getCurrentDatasetId` をデストラクチャリング
- 案件未選択ガード: `!currentCase` の場合、案件選択を促すUI表示

#### 2-5. SetupGuard の強化 ★元プランで見落とし

**ファイル:** `src/App.jsx` (L54-59)

現在のチェック: `isAdsAuthenticated && isSetupComplete`
追加チェック:
- `isCaseAuthenticated` — 案件認証済みか
- `setupState.datasetId === currentCase?.dataset_id` — dataset整合性

不一致時 → `/ads/wizard` へリダイレクト

#### 2-6. 下流ページ — 修正不要 ★元プランのスコープ縮小

EssentialPack, AnalysisGraphs, AiExplorer は `reportBundle` をコンテキスト経由で消費。
`dataset_id` を直接参照していないため、`buildAdsReportBundle` と `SetupGuard` の修正で十分。
**個別ページの「整合性チェック追加」は不要。**

#### 対象ファイル
- `src/api/adsInsights.js` — 修正（`withDefaultDataset()` 廃止）
- `src/utils/adsReports.js` — 修正（フォールバック除去）★追加
- `src/contexts/AdsSetupContext.jsx` — 修正（案件スコープ + マイグレーション）
- `src/pages/SetupWizard.jsx` — 修正（4箇所のハードコード除去 + ガード）
- `src/App.jsx` — 修正（SetupGuard 強化）★追加

**既存インフラ（変更不要）:**
- `src/components/CaseAuthModal.jsx` — 既に完全動作（loginCase → dataset_id 返却済み）
- `src/components/CaseSelector.jsx` — 基本機能は動作済み

---

### Phase 3: フロントエンド — 案件管理UI

#### 3-1. 案件管理ページ（新規）

**ファイル:** `src/pages/CaseManagement.jsx` — 新規作成

- 案件一覧テーブル（名前、dataset_id、ステータス）
- 新規案件登録フォーム
- BQ接続テストボタン
- 案件編集機能

#### 3-2. CaseSelector の改善

**ファイル:** `src/components/CaseSelector.jsx` — 修正

- BQ接続ステータス表示
- 案件切替時の確認ダイアログ

#### 3-3. ルーティング・ナビ追加

- `src/App.jsx` — `/cases` ルート追加
- `src/components/Layout.jsx` — サイドバーに案件管理リンク

---

## エージェントチーム構成（最適化版）

### Wave 1（3エージェント並列）★改善: CaseManagement を Wave 1 に昇格

| Agent | 担当 | 対象 | 理由 |
|-------|------|------|------|
| Agent A | Cases API 書き直し + cases.json拡張 + login + bq-status | `tmp_ads_insights_repo/` | バックエンド独立 |
| Agent B | API層 (`adsInsights.js`) + `adsReports.js` + `AdsSetupContext` 案件スコープ化 | `src/api/`, `src/utils/`, `src/contexts/` | コア配線、ファイル重複なし |
| Agent C | CaseManagement.jsx 新規 + App.jsx ルート + Layout.jsx ナビリンク | `src/pages/`, `src/components/Layout.jsx` | **完全新規ページ、依存ゼロ** |

**スキル:** `/agent-team-workflow` で Wave 実行

### Quality Gate 1: `/codex-review` 実行
- `adsInsights.js`, `adsReports.js`, `AdsSetupContext.jsx`, `backend_api.py` を対象にレビュー

### Wave 2（2エージェント並列）

| Agent | 担当 | 依存 |
|-------|------|------|
| Agent D | SetupWizard 4箇所修正 + SetupGuard 強化 | Agent B（API関数・コンテキスト更新後） |
| Agent E | CaseSelector ステータス表示 + 確認ダイアログ | Agent A（APIレスポンス形式確定後）+ Agent C |

### Quality Gate 2: `/codex-review` 実行

### Wave 3（1エージェント）

| Agent | 担当 |
|-------|------|
| Agent F | 統合検証（フルフロー動作確認） |

---

## クロスリポ戦略

1. Agent A は `tmp_ads_insights_repo/` 内で作業
2. Wave 1 完了 + Quality Gate 通過後:
   ```bash
   cd tmp_ads_insights_repo && git add -A && git commit -m "feat: multi-client cases API" && git push origin main
   ```
3. Render が main push で自動デプロイ（要確認）
4. **デプロイ順序:** バックエンド先行（追加的変更のみ、破壊的変更なし）→ フロントエンド後行

---

## 検証方法

### Wave 1 完了後

```bash
# Backend (Agent A)
curl http://localhost:8001/api/cases                    # dataset_id含む一覧
curl -X POST http://localhost:8001/api/cases/login \
  -d '{"case_id":"petabit","password":"..."}'           # dataset_id返却
curl http://localhost:8001/api/cases/petabit/bq-status  # BQ接続OK

# API層 (Agent B)
grep -n "DEFAULT_ADS_DATASET_ID" src/api/adsInsights.js
# → L2 (export宣言) のみ残存。withDefaultDataset() は消滅
grep -n "DEFAULT_ADS_DATASET_ID" src/utils/adsReports.js
# → 0件（importも除去）

# CaseManagement (Agent C)
grep "/cases" src/App.jsx                               # ルート存在
grep "案件管理" src/components/Layout.jsx               # ナビリンク存在
```

### Wave 2 完了後

```bash
grep -n "DEFAULT_ADS_DATASET_ID" src/pages/SetupWizard.jsx
# → 0件
grep -n "getCurrentDatasetId" src/pages/SetupWizard.jsx
# → 4件（L173, L186, L196, L99相当）
grep -n "isCaseAuthenticated" src/App.jsx
# → SetupGuard内に存在
```

### 統合テスト（Wave 3）

1. 案件選択 → 認証 → SetupWizard → レポート生成 → 各ページ閲覧
2. 案件切替 → setupリセット → キャッシュ復元
3. **ペタビット回帰テスト:** 既存フロー正常動作
4. **localStorage確認:** `insight-studio-ads-setup:petabit` 形式で保存

---

## ロールバック戦略

| 障害 | 対応 |
|------|------|
| フロントエンドのみ問題 | `git revert` → Vercel即時再デプロイ（< 2分） |
| バックエンドのみ問題 | `git revert` → Render再デプロイ（< 5分） |
| 両方問題 | フロントエンド先にrevert → バックエンドrevert |

**安全な理由:** バックエンド変更は全て追加的（新エンドポイント + 新フィールド）。既存エンドポイントのデフォルト値は維持するため、旧フロントエンドでも動作する。

---

## リスクと注意点

1. **既存データ互換:** localStorage マイグレーション処理が最重要。テスト必須
2. **`backend_api.py` 巨大（14,672行）:** 変更箇所（L2490 `api_cases()` + L1269 `_AUTH_PUBLIC_PATHS`）を最小限に
3. **GCP権限:** 新データセットへのサービスアカウント権限付与は手動
4. **Renderデプロイ:** main push で自動デプロイされるか要確認
