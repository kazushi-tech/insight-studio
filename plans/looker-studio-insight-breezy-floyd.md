# AI考察ページ（AiExplorer）Stitch 2.0 フルリニューアル

> ℹ️ ファイル名は plan mode 自動生成のため Looker Studio 風の識別子になっておるが、内容は **② AI考察UI Stitch 2.0 リニューアル** のプランじゃ。
> **①広告KPI取込み（BQ Data Transfer + 自前UI）は別の plan mode セッションで別ファイルに起票予定。** バッティング回避のため②を先行。

---

## Context

[src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx)（683行）はチャット吹き出し型UIで、AI応答を `max-w-5xl` 固定幅バブルに閉じ込めている。ユーザーからの要望:

- チャット感が強く、広い画面で「見切れる」
- HTML/markdown/テーブル/グラフィカル表現で見やすく
- UI/UXは Stitch 2.0 で統一

**重要な発見**:

- API `POST /api/neon/generate` は plain markdown 文字列 (`content`) のみ返却。chart_data は AI 応答には含まれない。代わりに `reportBundle.chartGroups` がフロント側に既に存在し、`buildAiChartContext` でプロンプト付与されている（[AiExplorer.jsx:221-224](src/pages/AiExplorer.jsx#L221-L224)）
- [src/components/ads/ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) は Chart.js 統合済みで `reportBundle.chartGroups` をそのまま描画可能
- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) は `variant="discovery"` でセクションカード化が既に実装済み（L387, L658）→ **`variant="ai-insight"` 追加が最短**
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) の `?ui=v2` + localStorage 機構が既存 → **feature flag を新設する必要なし**
- Stitch 2.0 基盤 [src/components/report/v2/](src/components/report/v2/)（ReportViewV2, reportThemeV2.js, tokens.css）を参照資産として活用

**方針**: 完全な新ページ化や API 構造化は最終 Phase に置き、**レイアウト刷新 → グラフ埋め込み → 軽量構造化（任意）** の 3 Phase で段階的に刷新する。**各 Phase の実装着手前に Stitch 2.0 でデザイン合意を取る**（Phase 0）。

---

## Phase 0 — Stitch 2.0 デザイン合意（実装前ゲート）

### 前提

- 既存 Stitch 2.0 プロジェクト **「Ad Insights & Data Integration」** の続きとして生成する
- Botanical Studio カラーパレット（#003925系）・Manrope フォント・カード16px角丸の design system は既に確立済み
- 期間要約 / 広告考察（グラフ）画面の既存レイアウトと統一感を保つ
- 各 Phase 実装直前にプロンプトを投げ、生成画像を `plans/design/ai-explorer-v2/` に `phase1-layout.png` 等で保存

### Phase 1 用プロンプト（AI考察 全体レイアウト）

```text
既存の「広告考察：グラフ」画面と統一感のある「AI考察レポート」画面を新規作成してください。
現状はチャットボット風UIですが、レポート型UIに刷新したいです。

■ レイアウト（PC 1440px、ダーク/ライト両対応不要・ライトのみ）
- 上部ヘッダーバー: タイトル「AI考察」/ フォントサイズ切替 / Market Lens連携トグル / コンテキストモード選択
- 中央: フルワイドの「Insightターンカード」を縦に積む
  - 旧チャット吹き出し（max-w-5xl・三角つき）は廃止
  - カード1枚でAI応答を完結表示（見切れ禁止）
- ユーザー質問: カード上部に小さなpill型で折り畳み表示（UserPromptPill）
- AI応答本文: アバター + 生成時刻 + 開閉トグル + セクション分割された markdown
- 下部: スティッキーな入力欄 + クイックプロンプト3ボタン（既存画面の動線を踏襲）

■ デザイン: 「広告考察：グラフ」画面と同じ Botanical Studio トーン
■ 参考: 既存「期間要約 Executive Summary」画面のカード密度と揃えてほしい
```

### Phase 2 用プロンプト（関連グラフパネル）

```text
前回作成したAI考察レポートのInsightターンカード下部に「関連グラフ」セクションを追加。

- 折り畳み可能なアコーディオン「関連グラフ (N)」
- 展開時: 横並び最大3カード（折線 / 棒 / ドーナツ）
- 各グラフカード: タイトル + Chart + 「キーインサイト」1行
- 既存「広告考察：グラフ (Excel反映済み)」のチャートカード意匠を流用
```

### Phase 3 用プロンプト（サマリーヒーロー）

```text
AI応答の冒頭に表示する「サマリーヒーロー」カード。

- 左: TL;DR 1〜3行（大きな見出し）
- 右: KPIピル3〜4個（label + value + delta矢印）
- 下部: 「推奨グラフ」チップ（クリックで該当グラフへジャンプ）
- 信頼度バー（既存 ConfidencePill 系デザインと統一）
- 既存「期間要約 Executive Summary」のサマリーカードと同じ密度感
```

### 完了条件

- Phase 1 のモックをユーザーが承認 → Phase 1 実装着手
- 同様に Phase 2, Phase 3 も実装直前にデザイン確定
- モック画像は `plans/design/ai-explorer-v2/` に保存し、PR に添付

---

## Phase 1 — レイアウト刷新（API 据え置き、フロント完結）

**目的**: 「見切れ」解消 + Stitch 2.0 ルック適用。バックエンド変更なし。

### 変更対象ファイル

- 編集: [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx)（部分リファクタ、V1コードは `useUiVersion` で保全）
- 編集: [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx)（`variant="ai-insight"` 追加）
- 新規: `src/components/ai-explorer/v2/InsightTimeline.jsx`
- 新規: `src/components/ai-explorer/v2/InsightTurnCard.jsx`
- 新規: `src/components/ai-explorer/v2/UserPromptPill.jsx`
- 新規: `src/components/ai-explorer/v2/AiExplorerV2.module.css`

### 主要変更点

1. **レイアウト**: `h-[calc(100vh-4rem)]` の縦 flex は維持。本体エリアを `max-w-[1400px] mx-auto` に拡大し `max-w-5xl` バブル廃止。
2. **ターン表現**: `isAssistantMessage` 分岐を `<InsightTurnCard>` 単一コンポーネントに統合。AI応答は「アバター+時刻+開閉トグル付きセクションカード」、ユーザー質問は上部に小さな `<UserPromptPill>` として折り畳み。吹き出し三角（`rounded-tl-none`）撤廃。
3. **MarkdownRenderer**: 既存 `variant="discovery"`（L387, L658）をベースに `variant="ai-insight"` を追加。セクションカードの余白/フォントを [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js) と `tokens.css` のトークンに合わせる。既存 `variant="discovery"` の挙動に干渉しないよう分岐追加のみ。
4. **クイックプロンプト**: 既存3ボタン（初期画面中央）をヘッダー右寄せの Stitch カードに移動。会話中は上部スティッキーバーに縮退。
5. **会話履歴**: `messages` 配列と `setDraft('ai-explorer', ...)` の永続化ロジックは不変。

### 据え置き（触らない）

`neonGenerate` / `getAdsText` / `normalizeAdsPayload` / `AdsSetupContext` / `AnalysisRunsContext` / `UserProfileContext` / フォントサイズ切替 / Market Lens 連携 / エラーバナー。

### Feature Flag

[src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) を AiExplorer にも導入し `isV2` で V1/V2 ルートを分岐。デフォルトは `v1`（既存挙動）、`?ui=v2` で新UI。品質確認後に `DEFAULT = 'v2'` 切替。

---

## Phase 2 — グラフ埋め込み対応（フロント完結）

**目的**: 「グラフィカル表現」要望を最短で実現。バックエンド変更なし。

### アプローチ

**採用**: `reportBundle.chartGroups` を `<InsightTurnCard>` に補助パネルとして差し込む。AI応答で言及されたグラフを `ai_chart_context` のタイトル/KPI マッチで 0〜3 件絞り込み、カード下部の「関連グラフ」タブで `ChartGroupCard` を表示。

**不採用**: markdown 内 ` ```chart ``` ` フェンスを AI に書かせて JSON 構造化する案は、プロンプト追加しても AI の忠実度が不安定（Discovery の AxisMapping 既存実績）。Phase 2 ではメタデータマッチングを採用し、フェンス方式はフォールバック実装のみ。

### 変更対象ファイル

- 新規: `src/components/ai-explorer/v2/InsightChartPanel.jsx`
- 編集: [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx)（` ```chart ``` ` フェンス検出追加。JSON パース失敗時は通常 `<pre>` にフォールバック → 前方互換）
- 編集: [src/utils/adsReports.js](src/utils/adsReports.js)（`buildAiChartContext` 近辺に `matchRelevantCharts(aiContent, chartGroups)` を追加）

### 主要変更点

1. `InsightTurnCard` に `chartGroups` prop 追加。レスポンス確定時にタイトル/KPI正規表現マッチで関連チャートを選出。
2. カード下部に折り畳み「関連グラフ (N)」節を追加、[ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) を並べる。
3. `MarkdownRenderer` の `pre` コンポーネントで ` ```chart {json} ``` ` 判定追加。JSON パース成功 & `{labels, datasets}` を持つ場合のみ `ChartGroupCard` に委譲。失敗時は通常 `<pre>` 表示（後方互換）。

---

## Phase 3 — 軽量構造化レスポンス（バックエンド連携、任意）

**目的**: AI応答冒頭にサマリー指標ヒーローを自動描画。

### 最小変更方針

[backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) のシステムプロンプト末尾に「markdown 本文の末尾に ` ```insight-meta ``` ` フェンスで JSON 要約 `{tldr:[], key_metrics:[{label,value,delta}], recommended_charts:[title]}` を必ず付与」を追記。**レスポンス形式 `{ok, content}` は不変**。フロントは `content` から `insight-meta` ブロックを抽出し、ヒーロー指標カードを AI応答冒頭に描画。

### 変更対象ファイル

- 編集: [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py)（システムプロンプト末尾に1節追記のみ、APIスキーマ不変）
- 新規: `src/utils/adsResponse.js` に `extractInsightMeta(markdown)` 追加（既存ユーティリティと同居）
- 新規: `src/components/ai-explorer/v2/InsightSummaryHero.jsx`（[PriorityActionHeroV2.jsx](src/components/report/v2/PriorityActionHeroV2.jsx) を参考に簡略版）

### ロールバック可能性

プロンプト追記は後方互換（メタが無ければフロントは hero を非表示）。問題時はプロンプト1行削除で即時戻せる。

---

## Verification

CLAUDE.md 規定により `src/` 配下の変更は `webapp-testing` skill で Playwright 検証必須。

### 必須チェック

1. **`npm run build`**（各 Phase ごと）: 型・Tailwind v4 + Vite ビルド確認。
2. **Vitest**: 新規コンポーネントのテストを [src/components/report/v2/__tests__/](src/components/report/v2/__tests__/)（例: `CompetitorMatrixV2.test.jsx`）の体裁に倣って追加。`MarkdownRenderer` の ` ```chart ``` ` 分岐は JSON パース失敗ケースを必ずカバー。
3. **Playwright**（`webapp-testing` skill の `scripts/with_server.py` で `npm run dev` port 3002 起動後、ゲストモード Chrome）:
   - `/ai-explorer?ui=v1` 既存挙動が壊れていない（回帰）
   - `/ai-explorer?ui=v2` でクイックプロンプト3件が送信可能、AI応答がフルワイドカードで表示、テーブル/markdown が横スクロールせず収まる（≥1440px）
   - 関連グラフが AI応答直下にレンダリングされる（Phase 2 完了時）
   - フォントサイズ切替・Market Lens トグル・コンテキスト更新・チャット消去が V2 でも動作
4. **リグレッション確認**（共有 Layout / MarkdownRenderer）:
   - Dashboard, Discovery, Compare が V1/V2 切替の影響を受けない
   - Discovery は `variant="discovery"` を既に使用 → `variant="ai-insight"` 追加が干渉しないことを snapshot 検証
5. **`page.on('console', ...)`** でコンソールエラー・ネットワークエラーを拾い、結果とあわせて報告（CLAUDE.md 遵守）。

---

## ロールアウト順序

1. **Phase 1**（UIのみ）→ ローカル検証 → PR → マージ → `?ui=v2` で試用
2. **Phase 2**（グラフ埋め込み）→ 同上
3. 品質確認後に `src/hooks/useUiVersion.js` の `DEFAULT = 'v2'` 切替
4. **Phase 3**（任意）: プロンプト追記 + hero 導入

---

## Critical Files

- [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) — メインページ刷新
- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) — variant拡張 + chartフェンス検出
- [src/components/ads/ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) — 再利用（変更なし）
- [src/components/report/v2/ReportViewV2.module.css](src/components/report/v2/ReportViewV2.module.css) — トークン参照元
- [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js) — Stitch 2.0 カラー/スペーシング
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) — V1/V2 切替（流用）
- [src/utils/adsReports.js](src/utils/adsReports.js) — `matchRelevantCharts` 追加
- [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) — Phase 3 のみプロンプト追記

---

## 検討した代替案（却下）

1. **チャット維持 + 吹き出しのみ Stitch 化**: 見切れの根本原因（`max-w-5xl`）を一時解消するが、タイムライン感が残り「チャット感が強い」要望を満たせない → 却下。
2. **完全新ページ `/ai-insight-v2`**: ルート追加、`AnalysisRunsContext` の draft キー分岐、履歴互換性破壊。コスト高 → 却下。`useUiVersion` ベースのインプレース切替で同等効果。
3. **API を構造化形式 `{markdown, charts[], tables[]}` に全面変更**: バックエンド / プロンプト / フロント全て改修。コスト高く ROI 低い → 却下。Phase 3 の軽量構造化で段階的に拡張。
4. **`ReportViewV2` 直接流用**: `PriorityActionHeroV2` 等は `envelope` 形式を前提とし、AI応答（plain markdown）には envelope が無い → 不適合。デザイントークンとレイアウト思想のみ参照する方針とした。

---

## 次セッション TODO（別プラン）

- **①広告KPI取込み**: Google Ads → BigQuery Data Transfer Service 公式コネクタで自動日次転送 → `backends/ads-insights/bq/queries.py` 新クエリ + `/api/ads/kpi/*` エンドポイント + 新ページ `src/pages/AdsKPI.jsx`。本プラン完了後に別 plan mode セッションで起票する。

---

## 📘 Handoff Plan: 別セッション Claude への実装引継ぎ

**承認後、以下の全文を新規ファイル `plans/2026-04-19-ai-explorer-v2-phase1-handoff.md` として作成する。**
Phase 0（デザイン合意）は完了済み。モックは `plans/design/ai-explorer-v2/` に保存済み（`phase1-loading.png/`, `phase1-empty-state.png/`, `phase1-history-drawer.png/`, `phase1-period-selector.png/`, `phase1-response-table.png/`, `phase2-related-charts.png/` の6点、各フォルダに `DESIGN.md + code.html + screen.png`）。

---

### 📄 新規ファイル全文（handoff プラン）

````markdown
# AI考察（AiExplorer）Stitch 2.0 リニューアル — Phase 1+2+3 実装 Handoff

> **この文書は別セッションの Claude に渡すための自己完結型の実装手順書じゃ。**
> 本文書だけで作業開始から PR 作成まで実行できるよう設計されておる。
> agent-team-workflow と主要 skill を駆使して効率的に進めること。

---

## 0. Mission

[src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx)（683行、チャット吹き出し型）を Stitch 2.0 レポート型 UI に刷新する。

- **課題**: `max-w-5xl` 固定幅で情報が見切れる、チャット感が強すぎる、テーブル/グラフ表現が弱い
- **解決**: フルワイド InsightTurnCard + 関連グラフ埋め込み + サマリーヒーロー（任意）

3 Phase 段階実装:
1. **Phase 1** レイアウト刷新（フロント完結）
2. **Phase 2** 関連グラフ埋め込み（`reportBundle.chartGroups` 再利用）
3. **Phase 3** 軽量構造化レスポンス（バックエンド プロンプト1節追記、任意）

Phase 0（Stitch 2.0 デザイン合意）は親プラン [plans/looker-studio-insight-breezy-floyd.md](plans/looker-studio-insight-breezy-floyd.md) で完了済み。

---

## 1. Prerequisites

### 1.1 Worktree セットアップ（必須）

master ブランチを汚さず並列作業可能にするため git worktree で隔離する:

```bash
cd "c:/Users/PEM N-266/work/insight-studio"
git worktree add ../insight-studio-ai-v2 -b feat/ai-explorer-v2
cd ../insight-studio-ai-v2
npm install
```

完了後の作業は全て `../insight-studio-ai-v2` 配下で行うこと。

### 1.2 環境確認

```bash
node --version   # v18+
npm --version    # v9+
python --version # 3.10+
```

初回のみ Playwright を用意:

```bash
pip install playwright
python -m playwright install chromium
```

### 1.3 ローカル3サービス起動

```powershell
./dev.ps1   # フロント(3002) + market-lens(8002) + ads-insights(8001)
```

---

## 2. Design Reference（必読）

`plans/design/ai-explorer-v2/` 配下にモック6点。各フォルダに `DESIGN.md + code.html + screen.png`。

| ファイル | 内容 | 対応 Phase |
|---------|------|-----------|
| `phase1-empty-state.png/` | 初期空状態、クイックプロンプト3枚 | Phase 1 |
| `phase1-loading.png/` | 生成中スケルトン + 質問Pill残留 | Phase 1 |
| `phase1-history-drawer.png/` | 履歴ドロワー（TODAY/YESTERDAY/LAST WEEK） | Phase 1 |
| `phase1-period-selector.png/` | 2ヶ月並列カレンダー + 5プリセット | Phase 1 |
| `phase1-response-table.png/` | AI応答内テーブル（5列×10行、赤色警告） | Phase 1 |
| `phase2-related-charts.png/` | 関連グラフ展開3パネル（折線/棒/ドーナツ） | Phase 2 |

`code.html` は Tailwind 実装の参照。クラス名をそのままコピーせず、Insight Studio の既存トークン（`reportThemeV2.js` / `tokens.css`）に合わせて再構築する。

### デザイン原則（モック承認済み）

- **サイドバー**: `Insight Studio / AI ANALYSIS CORE` ロゴ、Nav = `Dashboard / Discovery / Compare / AI Insight / Settings`、下部ボタン `+ 新しい考察`
- **ヘッダー**: `AI考察` タイトル + 期間セレクター + Market Lens トグル + Context Mode + フォントサイズ切替
- **カラー**: Botanical Green `#003925`, warm off-white `#fafaf5`, 16px角丸カード, 12px角丸ボタン
- **言語**: 全テキスト日本語（英語残留は即 NG）

---

## 3. Current Codebase Facts

### 3.1 必読ファイル

| ファイル | 役割 | 触るか |
|---------|------|-------|
| [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) | メインページ 683行 | **編集** — `useUiVersion` で V1/V2 分岐 |
| [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) | 既存 `variant="discovery"` L387, L658 | **編集** — `variant="ai-insight"` 追加 |
| [src/components/ads/ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) | Chart.js 統合済 | 再利用のみ、**変更禁止** |
| [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) | `?ui=v2` + localStorage | 流用、**変更禁止** |
| [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js) | Stitch 2.0 カラー/スペーシング | 参照のみ |
| [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css) | CSS カスタムプロパティ | 参照のみ |
| [src/utils/adsReports.js](src/utils/adsReports.js) | `buildAiChartContext` 近辺 | **編集** — Phase 2 で `matchRelevantCharts` 追加 |
| [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) | `/api/neon/generate` | **Phase 3 のみ編集** — システムプロンプト末尾1節追記 |

### 3.2 触らない（重要）

`neonGenerate` / `getAdsText` / `normalizeAdsPayload` / `AdsSetupContext` / `AnalysisRunsContext` / `UserProfileContext` / フォントサイズ切替 / Market Lens 連携 / エラーバナー / `messages[]` 配列永続化（`setDraft('ai-explorer', ...)`)。

### 3.3 API 形式

`POST /api/neon/generate` レスポンス: `{ ok: boolean, content: string }`. `content` は plain markdown。chart_data は含まれない。

---

## 4. Agent Team 戦略

**`/agent-team-workflow` skill を最初に起動して Phase 1 を 5 トラック並列展開せよ。**

### 4.1 Phase 1 並列トラック

```text
Phase 1 並列展開（worktree 隔離、agent-team-workflow）
├── Track A: CSS Module 基盤 (AiExplorerV2.module.css)
├── Track B: UserPromptPill (原子)
├── Track C: PeriodSelector (原子、AnalysisRunsContext 読み取り専用)
├── Track D: MarkdownRenderer variant="ai-insight" 追加
└── Track E: QuickPromptCard + LoadingSkeleton (原子)
         ↓
    統合 Track F: InsightTurnCard + InsightTimeline (A-E 全完了後)
         ↓
    統合 Track G: AiExplorer.jsx に isV2 分岐導入
         ↓
    Phase 1 検証ゲート（Playwright + codex-review）
```

Track A-E は**完全独立**（他 Track 完了を待たない）。Track F-G は順次統合。

### 4.2 Agent 使い分け

| シーン | Agent | 理由 |
|--------|-------|------|
| コードベース探索（変数命名規則・既存パターン確認等） | `Explore` | 3クエリ以上の open-ended 探索 |
| 特定ファイル内の symbol 検索 | Grep 直接 | Agent 不要 |
| `matchRelevantCharts` 設計 | `Plan` | アルゴリズム設計要 |
| Track A-E 並列実装 | `general-purpose` + `isolation: "worktree"` | 独立実装 |
| PR 前のコードレビュー | **`/codex-review`** skill | 各 Phase 必須 |

### 4.3 Skills 活用マップ

| スキル | タイミング | 用途 |
|--------|-----------|------|
| `/code-explorer` | 初動 | [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) 全体構造把握 |
| `/agent-team-workflow` | Phase 1 Track 起動時 | 5 並列トラック管理 |
| `/webapp-testing` | **各 Phase 完了時必須** | Playwright で `?ui=v2` 検証 + リグレッション |
| `/project-health` | PR 前 | build + 型 + vitest 一括 |
| **`/codex-review`** | **各 Phase の PR 前必須** | 品質ゲート |
| `/quick-git` | 随時 | worktree 内 status/commit/push |

---

## 5. Phase 1 — レイアウト刷新

### 5.1 新規ファイル（8点）

```text
src/components/ai-explorer/v2/
├── AiExplorerV2.module.css
├── UserPromptPill.jsx
├── PeriodSelector.jsx
├── QuickPromptCard.jsx
├── LoadingSkeleton.jsx
├── InsightTurnCard.jsx
├── InsightTimeline.jsx
└── __tests__/
    ├── UserPromptPill.test.jsx
    ├── PeriodSelector.test.jsx
    ├── QuickPromptCard.test.jsx
    ├── InsightTurnCard.test.jsx
    └── InsightTimeline.test.jsx
```

### 5.2 編集ファイル（2点）

- [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) — `useUiVersion` 導入、`isV2` 分岐
- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) — `variant="ai-insight"` 追加

### 5.3 Track 詳細仕様

#### Track A — CSS Module 基盤

`AiExplorerV2.module.css` 作成。`tokens.css` の CSS 変数を `var(--color-primary)` 等で参照。主要クラス:

- `.timeline` — `max-width: 1400px; margin: 0 auto;`
- `.turnCard` — 16px角丸、背景 `var(--color-surface)`、`box-shadow: var(--shadow-sm)`
- `.promptPill` — 折り畳みヘッダー、pill 形状
- `.sectionCard` — markdown セクション内カード
- `.headerBar` — position: sticky, top: 0, z-index: 10
- `.quickPromptGrid` — `grid-template-columns: repeat(3, 1fr)`
- `.loadingSkeleton` — アニメーション shimmer

#### Track B — UserPromptPill

```jsx
// Props: { content: string, timestamp: string, expanded?: boolean, onToggle?: () => void }
// モック参照: 全画面の上部質問 pill
// 折り畳み時: 1行省略、aria-expanded 対応
```

#### Track C — PeriodSelector

```jsx
// Props: { analysisRun, onApply?: (range) => void }
// モック参照: phase1-period-selector.png/
// - 2ヶ月並列カレンダー（current month + previous month）
// - プリセット: 過去7日 / 過去30日 / 過去90日 / 今四半期 / カスタム
// - 表示: AnalysisRunsContext の current run から期間読み取り
// - API 変更なし。onApply は optional（現状は表示専用）
// - Popover 実装は [src/components/ui/](src/components/ui/) 既存あれば流用
```

#### Track D — MarkdownRenderer variant="ai-insight"

```jsx
// L387 / L658 の variant="discovery" ブロックを複製、
// 以下のみ差分:
// - セクションカード margin: tokens.css の --space-lg 準拠
// - h2/h3 フォントサイズを reportThemeV2.js の heading トークンに
// - ul/ol の bullet を緑丸（Botanical Green）
// - variant="discovery" に干渉しないこと（snapshot test で担保）
```

#### Track E — QuickPromptCard + LoadingSkeleton

```jsx
// QuickPromptCard
// Props: { icon, title, description, onClick }
// モック参照: phase1-empty-state.png/
// - 3列グリッドの1枚（icon + bold title + description）

// LoadingSkeleton
// Props: { withPromptPill?: boolean }
// モック参照: phase1-loading.png/
// - 「考察を生成中です... ✨」+ プログレスバー
// - skeleton bars × 5
```

#### Track F — InsightTurnCard + InsightTimeline（統合）

```jsx
// InsightTurnCard
// Props: {
//   turn: { userPrompt, userTimestamp, aiContent, aiTimestamp },
//   chartGroups?: Array, // Phase 2 で有効化
//   insightMeta?: Object, // Phase 3 で有効化
// }
// 構造:
// <article className={styles.turnCard}>
//   <UserPromptPill content={...} timestamp={...} />
//   {insightMeta && <InsightSummaryHero meta={insightMeta} />} {/* Phase 3 */}
//   <MarkdownRenderer content={aiContent} variant="ai-insight" />
//   {chartGroups?.length > 0 && <InsightChartPanel groups={chartGroups} />} {/* Phase 2 */}
// </article>

// InsightTimeline
// Props: { messages, onSubmit, analysisRun, ...既存propsほぼ全て }
// - messages[] を user/assistant ペアに整形し InsightTurnCard に渡す
// - 空状態: 中央に QuickPromptCard × 3 グリッド
// - 生成中: 最下部に LoadingSkeleton
// - 下部スティッキーに入力欄 + 送信ボタン
```

#### Track G — AiExplorer.jsx 統合

```jsx
import { useUiVersion } from '../hooks/useUiVersion.js';
import InsightTimeline from '../components/ai-explorer/v2/InsightTimeline.jsx';

// ...既存 state / effect 全て維持...

const { isV2 } = useUiVersion();

return isV2 ? (
  <InsightTimeline
    messages={messages}
    onSubmit={handleSubmit}
    analysisRun={currentRun}
    draft={draft}
    onDraftChange={handleDraftChange}
    // ...既存 V1 が使う props 全て転送
  />
) : (
  /* 既存 V1 JSX を丸ごと保全 — 1行も削除しない */
);
```

### 5.4 Phase 1 完了条件

- [ ] `?ui=v1` で既存挙動完全保全（messages 履歴、フォントサイズ、Market Lens、Context Mode、エラーバナー、draft 永続化 全て動作）
- [ ] `?ui=v2` で 1400px 画面 でテーブル横スクロール無し、質問Pill折り畳み動作
- [ ] Dashboard/Discovery/Compare 画面に一切のリグレッションなし
- [ ] `variant="discovery"` の既存スナップショット不変
- [ ] 新規8コンポーネントに Vitest テスト付与
- [ ] `npm run build` 成功
- [ ] `/codex-review` skill 通過
- [ ] `/webapp-testing` skill で Playwright `?ui=v1` + `?ui=v2` + 隣接画面 各検証

### 5.5 Phase 1 PR

ブランチ: `feat/ai-explorer-v2-phase1`
タイトル: `feat(ai-explorer): Phase 1 layout renewal (v2 behind ?ui=v2 flag)`
本文に添付:
- `plans/design/ai-explorer-v2/*/screen.png` と実装スクショの比較画像
- Playwright 検証結果（コンソールエラー0件を明記）
- codex-review 結果サマリー

---

## 6. Phase 2 — 関連グラフ埋め込み

**Phase 1 PR マージ後に着手。** worktree は継続利用可（新規ブランチ `feat/ai-explorer-v2-phase2` を切る）。

### 6.1 新規ファイル

- `src/components/ai-explorer/v2/InsightChartPanel.jsx`

### 6.2 編集ファイル

- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) — ` ```chart ``` ` フェンス検出
- [src/utils/adsReports.js](src/utils/adsReports.js) — `matchRelevantCharts(aiContent, chartGroups)` 追加（`buildAiChartContext` 近辺）
- `src/components/ai-explorer/v2/InsightTurnCard.jsx` — `chartGroups` prop 有効化

### 6.3 実装方針

**採用**: `reportBundle.chartGroups` を `<InsightTurnCard>` に差し込み。AI応答テキストからタイトル/KPI 正規表現マッチで 0〜3件絞り込み、`ChartGroupCard` で表示。

**フォールバック**: ` ```chart {json} ``` ` フェンスを AI が書いた場合、MarkdownRenderer で検出し `{labels, datasets}` 形式のみ `ChartGroupCard` 委譲。JSON パース失敗時は通常 `<pre>` 表示（後方互換）。

### 6.4 `matchRelevantCharts` 疑似コード

```js
// src/utils/adsReports.js
export function matchRelevantCharts(aiContent, chartGroups, { limit = 3 } = {}) {
  if (!aiContent || !chartGroups?.length) return [];
  const scored = chartGroups.map(group => {
    const titleHit = aiContent.includes(group.title) ? 3 : 0;
    const kpiHit = (group.kpis ?? []).reduce(
      (n, kpi) => n + (aiContent.includes(kpi.label) ? 1 : 0), 0);
    return { group, score: titleHit + kpiHit };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.group);
}
```

### 6.5 Phase 2 完了条件

- [ ] `?ui=v2` で AI 応答下部にアコーディオン「関連グラフ(N)」
- [ ] ` ```chart ``` ` JSON フェンスが `ChartGroupCard` で描画
- [ ] JSON パース失敗時 `<pre>` フォールバック（前方互換）
- [ ] `matchRelevantCharts` 単体テスト
- [ ] Discovery の `variant="discovery"` 回帰なし
- [ ] `/codex-review` + `/webapp-testing` 通過

---

## 7. Phase 3 — 軽量構造化レスポンス（任意）

**Phase 2 PR マージ後。バックエンド変更含むが、プロンプト1節追記のみで後方互換。**

### 7.1 新規ファイル

- `src/utils/adsResponse.js` — `extractInsightMeta(markdown)` 
- `src/components/ai-explorer/v2/InsightSummaryHero.jsx` — `PriorityActionHeroV2.jsx` を簡略化

### 7.2 編集ファイル

- [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) — システムプロンプト末尾に1節追記:

```text
【末尾要件】必ず markdown 本文の末尾に ```insight-meta で囲んだ JSON サマリーを付与せよ。
形式:
{
  "tldr": ["1-3行の要点"],
  "key_metrics": [{"label": "CVR", "value": "+14.2%", "delta": "up"}],
  "recommended_charts": ["グラフタイトル"]
}
```

- `src/components/ai-explorer/v2/InsightTurnCard.jsx` — `insightMeta` prop 有効化、先頭に hero 描画

### 7.3 Phase 3 完了条件

- [ ] 応答冒頭に TL;DR + KPI ピル 3〜4個 + 推奨グラフチップ描画
- [ ] `insight-meta` ブロック欠落時に hero 非表示（graceful degradation）
- [ ] `cd backends/ads-insights && python -m pytest` 通過
- [ ] `/codex-review` + `/webapp-testing` 通過

### 7.4 Rollback

プロンプト末尾の1節を削除するだけで Phase 2 状態に即座に戻せる。フロント側の `extractInsightMeta` は meta 無しでも null を返す実装にすること。

---

## 8. Verification Gates（全 Phase 共通）

### 8.1 必須チェック

`/webapp-testing` skill の `scripts/with_server.py` で `npm run dev` (port 3002) 起動 → ゲストモード Chrome:

1. `/ai-explorer?ui=v1` **既存挙動回帰確認**（messages 履歴保持、送信、フォントサイズ切替、Market Lens、Context Mode、エラー表示）
2. `/ai-explorer?ui=v2` 新 UI 動作確認（クイックプロンプト送信、フルワイド表示、テーブル・markdown 見切れなし ≥1440px）
3. Phase 2 以降: 関連グラフが AI応答直下にレンダリング
4. **隣接画面リグレッション**: Dashboard, Discovery, Compare を少なくとも1画面ずつ開き、共有 Layout / MarkdownRenderer の挙動確認
5. `page.on('console', ...)` + ネットワーク監視でエラー拾い、**結果報告に必ず含める**

### 8.2 ビルド & テスト

```bash
npm run build                       # フロントビルド
npx vitest run                      # 新規コンポーネント
cd backends/ads-insights && python -m pytest   # Phase 3 のみ
```

### 8.3 CLAUDE.md 準拠項目（抜粋）

- タイムアウト値を増やさない（根本原因修正）
- 推測変更禁止（ローカル再現→原因特定→修正→確認）
- 表面的エラー対応禁止
- デプロイ時は Vercel + Render 両方確認（今回は staging のみで OK）

---

## 9. Rollout

```text
Phase 1 PR → merge → master の ?ui=v1 デフォルトで試用
    ↓
Phase 2 PR → merge → ?ui=v2 で関連グラフ確認
    ↓
品質確認 → src/hooks/useUiVersion.js の DEFAULT = 'v2' 切替 PR (別 PR)
    ↓
Phase 3 PR（任意） → merge
```

---

## 10. 開始チェックリスト

作業開始前に以下を全チェック:

- [ ] Worktree `../insight-studio-ai-v2` 作成済、`npm install` 完了
- [ ] `plans/design/ai-explorer-v2/` 配下モック6点の `DESIGN.md` を全て読了
- [ ] `/code-explorer` skill で [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) 全体構造把握
- [ ] `/code-explorer` skill で [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) の `variant="discovery"` 実装箇所 L387, L658 確認
- [ ] [src/components/report/v2/](src/components/report/v2/) 配下の既存 v2 コンポーネント流儀確認
- [ ] [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css) + [reportThemeV2.js](src/components/report/v2/reportThemeV2.js) トークン一覧把握
- [ ] [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) 確認
- [ ] [src/components/ads/ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) 入出力把握
- [ ] `./dev.ps1` で3サービス起動確認
- [ ] `/agent-team-workflow` skill 起動、Track A-E 並列実装開始

---

## 11. 却下済み代替案（再検討不要）

1. チャット維持 + 吹き出しのみ Stitch 化 → タイムライン感残存で NG
2. 完全新ページ `/ai-insight-v2` → ルート追加コスト高、履歴互換性破壊で NG
3. API 全面構造化 `{markdown, charts[], tables[]}` → ROI 低で NG
4. `ReportViewV2` 直接流用 → envelope 形式前提で不適合

---

## 12. 参考資料

- 親プラン: [plans/looker-studio-insight-breezy-floyd.md](plans/looker-studio-insight-breezy-floyd.md)
- Design system: [src/components/report/v2/](src/components/report/v2/)
- CLAUDE.md: プロジェクトルート（テスト・デプロイ規約）
- グローバル CLAUDE.md: `~/.claude/CLAUDE.md`（skill 一覧）

````
