# Discovery Hub 競合拡張 × 末尾切り詰め解消 × UI/UX刷新 統合プラン

> **Agent Team 並列開発 + Skills駆動ワークフロー構成**
> 作成日: 2026-04-22 / ブランチ: master / 対象: `/discovery` (Discovery Hub)

---

## 1. Context（背景と根本原因）

### 1-1. ユーザー観測事実（ペタビット株式会社の分析結果）

広告運用プロ視点の指摘：
- **「競合が1社しか発見されていない」** — レポートは3サイト比較だが、実競合比較対象は辻・本郷ITコンサルティング1社のみ（タナベコンサルティングは参考観測枠に降格）
- **レポート末尾切れ** — 5-2 検索広告施策の途中で「⚠️ 自動注記: レスポンスが出力上限に達したため末尾が切り詰められた可能性があります」
- **UI/UXに改善余地あり** — Stitch2でプロンプト生成して修正予定、その前提で依頼

### 1-2. 調査で判明した根本原因（3系統）

| 系統 | 症状 | 根本原因 | 該当箇所 |
|------|------|---------|---------|
| 競合数 | 実分析=ブランド+競合2 に構造固定 | `DISCOVERY_MAX_COMPETITORS=3` / `DISCOVERY_ANALYZE_SITE_LIMIT=3` | [render.yaml:54-57](render.yaml#L54-L57), [discovery_pipeline.py:925](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L925) |
| 末尾切れ | `stop_reason=max_tokens` で5,120トークン超過 | 3サイト自動compactモード発動 + two-phase生成のバグ | [analyzer.py:68-81](backends/market-lens-ai/web/app/analyzer.py#L68-L81), [discovery_pipeline.py:991](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L991) |
| UI/UX | 参考観測枠が主比較と同視、Radar三角崩壊、Section5再生成導線なし | 既存プラン[未実装項目](plans/web-ai-ui-ux-polymorphic-umbrella.md)が棚卸し不十分 | [Discovery.jsx](src/pages/Discovery.jsx) (1198行), [CompetitorMatrixV2.jsx](src/components/report/v2/CompetitorMatrixV2.jsx), [BrandRadarV2.jsx](src/components/report/v2/BrandRadarV2.jsx) |

### 1-3. 重大発見（Phase1調査で検出）

1. **two-phase Section5再生成が常にスキップされている** — [discovery_pipeline.py:991](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L991) の条件 `attempt_index == 0` はバグ。for-loopは`enumerate(attempts, start=1)` なので、この条件は永遠にFalse。
2. **Wide/Deepプロンプト切替閾値** — [analyzer.py:1948-1953](backends/market-lens-ai/web/app/analyzer.py#L1948-L1953) の `>= 3` で wide へ切替 → Section5死守ロジックが無効化される（[plans/cozy-splashing-tiger.md](plans/cozy-splashing-tiger.md) で警告済）。
3. **LLM candidate validation無効化** — [discovery_routes.py:226](backends/market-lens-ai/web/app/routers/discovery_routes.py#L226) で `validate_candidates_fn=None` → タナベのような業界違い候補の自動除外が効いていない。

### 1-4. 意図した成果

- 競合分析対象をブランド+競合2（=3サイト）から **ブランド+競合3（=4サイト）** に拡張し、将来的に5サイトへ段階拡大
- レポート末尾切れを **自動再生成で解消** し、admin以外に警告を出さない
- Discovery.jsx の責務分割と v1削除 + Stitch2 v3 UI刷新で技術的負債を圧縮
- **クライアント提出品質のレポートを毎回安定的に出力**

---

## 2. Agent Team 編成と Skills マップ

本プランは中規模（12〜14 PR、Backend/Frontend両面）ゆえ、`agent-team-workflow` skill で **3 teams 並列開発** を基本とする。

### 2-1. Team編成

| Team | 責務 | 主要Skills | 担当PR |
|------|------|----------|--------|
| **Team-A: Backend Discovery** | Python/FastAPI パイプライン改修、token budget、timeout調整 | `market-lens-backend-guardrails` / `claude-api` | B-01 〜 B-06, Q-01 〜 Q-03 |
| **Team-B: Frontend Discovery** | React分割、v2コンポーネント改修、Stitch2統合 | `market-lens-frontend-review` / `ui-design-review` / `webapp-testing` / `devtools-verify` | F-01 〜 F-07 |
| **Team-C: Quality Gate** | 計画書レビュー、リグレッション検知、リリース判定 | `codex-review` / `universal-review` / `market-lens-release-check` / `market-lens-orchestrator` | 全PR横断ゲート |

### 2-2. Skills 投入タイミング

```
[Phase0] 計画書レビュー
  └─ codex-review (本プランのレビュー → Critical/Major 0 まで修正ループ)

[Phase1-3 各Phase開始時]
  └─ market-lens-orchestrator (全体統括 / 依存関係チェック)

[Backend PR作成時]
  ├─ claude-api (token budget / model ID / max_tokens 適正化確認)
  └─ market-lens-backend-guardrails (Discovery pipeline固有の罠を検知)

[Frontend PR作成時]
  ├─ market-lens-frontend-review (React/Tailwind/v2 tokens の準拠確認)
  ├─ ui-design-review (アクセシビリティ + デザイン準拠)
  ├─ webapp-testing (Playwright sync APIで目視確認)
  └─ devtools-verify (ゲストモードChromeでクリーンUI検証)

[各Phase完了時]
  └─ universal-review (変更diffの軽量レビュー)

[本番デプロイ前]
  └─ market-lens-release-check (Render / Vercel 同期確認)
```

### 2-3. 並列化のポイント

Team-A (Backend) と Team-B (Frontend) は **Phase2 以降は並列実行可能**。ただし以下は直列依存：
- `PR B-03` (MAX_COMPETITORS 4化) は `PR F-01` (Discovery.jsx分割) 前に絶対に触らない（テスト破壊リスク）
- `PR F-02` (警告CTA) は `PR B-06` の regenerate API 提供後にのみ結合テスト可能
- `PR F-07` (v1削除) はプラン全体の最終段

---

## 3. 実装Phase分解（ロールバック単位）

### Phase 0: 計画書ゲート

| 作業 | Skill | 成功基準 |
|------|-------|---------|
| 本プランの厳格レビュー | `codex-review` | Critical=0, Major=0 |
| ユーザー確認（§10） | AskUserQuestion / 会話 | 競合数・timeout・v1廃止について合意 |

### Phase 1: ブロッカー修正（Team-A、単独直列）

末尾切れの元凶となる2つのバグを最優先で潰す。競合数は変えない。

#### PR B-01: `attempt_index` バグ修正（two-phase復活）
- **変更**: [discovery_pipeline.py:991-996](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L991-L996)
  - `attempt_index == 0` → `attempt_index == 1`
  - `budget_remaining_sec >= 60.0` → `>= 45.0`
  - 条件に `and not use_compact` を追加
- **新規テスト**: `tests/test_discovery_pipeline.py::test_two_phase_section5_fires_on_first_attempt`
- **効果**: 末尾切れ率が体感で下がる（変更1行）

#### PR Q-01: Section 5 自動再生成の恒常化
- **変更**: [discovery_pipeline.py:990-1022](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L990-L1022)
  - `needs_phase2` 条件を `section_5_looks_complete(candidate_report_md)` or `truncated==True` に差し替え
  - `phase2_timeout = min(120.0, max(40.0, budget_remaining_sec - 15.0))`
- **変更**: [anthropic_client.py:162-166](backends/market-lens-ai/web/app/anthropic_client.py#L162-L166)
  - `_TRUNCATION_NOTICE` にadmin-only表示フラグを追加

---

### Phase 2: 準備層（Team-A、並列可）

競合数増加に耐えうる基盤整備。この時点では 3サイトのまま。

#### PR B-02: Search プール拡張
- [discovery_pipeline.py:615](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L615) で `num=min(12, max(10, max_competitors + 6))` に変更
- [anthropic_search_client.py:181](backends/market-lens-ai/web/app/services/discovery/anthropic_search_client.py#L181) で上限 12 → 15
- `DiscoveryAnalyzeResponse` に `candidate_pool_size` を追加

#### PR B-04: Wide/Deep プロンプト切替閾値の分離
- [analyzer.py:1948-1953](backends/market-lens-ai/web/app/analyzer.py#L1948-L1953) で `>= 3` → `>= 5`
- 4サイトまでは deep プロンプト継続（Section5死守ロジック有効）
- 例外: `compact_output==True` の場合は従来通り

#### PR B-05: Token budget 4サイト対応
- [analyzer.py:93-102](backends/market-lens-ai/web/app/analyzer.py#L93-L102) で `_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES`: 12288 → 14336
- `_comparison_output_token_budget()` を 3/4/5+ の3分岐に拡張
- **前提確認**: `claude-api` skill で Sonnet 4.6 の max_tokens 上限を検証

#### PR Q-02: compact発動閾値を段階化
- [analyzer.py:68-81](backends/market-lens-ai/web/app/analyzer.py#L68-L81) で `>= 3` → `>= 4`
- IT/戦略系業界のみ 3サイトから compact ON を維持

---

### Phase 3: 本命拡張（Team-A、直列）

#### PR B-03: MAX_COMPETITORS 3 → 4 + timeout延長
- [render.yaml](render.yaml#L47-L57):
  - `DISCOVERY_MAX_COMPETITORS`: 3 → 4
  - `DISCOVERY_ANALYZE_SITE_LIMIT`: 3 → 4
  - `DISCOVERY_ANALYZE_TIMEOUT_SEC`: 240 → 300
  - `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC`: 360 → 450
  - `DISCOVERY_FETCH_COMPETITORS_STALL_TIMEOUT_SEC`: 210 → 260
- [Discovery.jsx:113-146](src/pages/Discovery.jsx#L113-L146):
  - `POLL_HARD_CEILING_MS`: 380_000 → 470_000
  - `STAGE_TIMEOUT_MS.analyze`: 370_000 → 460_000
  - `STAGE_TYPICAL_SEC.analyze`: 35 → 55

> **critical**: frontend定数は同一PR内で同時更新（commit `22a77fe` の教訓）

#### PR Q-03: Two-phase generation のオプトイン化
- [discovery_pipeline.py:976](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L976) で `two_phase=(len(all_extracted) >= 4)`
- feature flag: `DISCOVERY_TWO_PHASE_FOR_4PLUS=true`

---

### Phase 4: 品質オプション（Team-A、ユーザー承認後）

#### PR B-06: LLM candidate validation 再有効化
- [discovery_routes.py:226, 400](backends/market-lens-ai/web/app/routers/discovery_routes.py#L226) で `validate_candidates_fn` を実装関数に戻す
- 新規: `backends/market-lens-ai/web/app/services/discovery/candidate_validator.py`
  - Haiku で「入力ブランドと同業界か」を候補ごとに並列判定（timeout 10s）

---

### Phase F: Frontend (Team-B、Phase1と並列開始可)

#### PR F-01: Discovery.jsx 分割（動作不変）
新規ディレクトリ `src/pages/discovery/` を作成：
- `ScoreDistributionChart.jsx` ([Discovery.jsx:33-106](src/pages/Discovery.jsx#L33-L106))
- `MetaBand.jsx` ([214-294](src/pages/Discovery.jsx#L214-L294))
- `PartialSuccessBanner.jsx` ([296-335](src/pages/Discovery.jsx#L296-L335))
- `DomainPlaceholder.jsx` ([350-366](src/pages/Discovery.jsx#L350-L366))
- `DiscoveredLpGrid.jsx` ([1085-1186](src/pages/Discovery.jsx#L1085-L1186))
- `pollingConstants.js` / `usePolling.js`

> **検証**: `webapp-testing` skill で `/discovery` フル動作確認（URL入力→完了→表示）

#### PR F-02: 品質警告2段化 + Section5再生成CTA
- [reportQuality.js](src/utils/reportQuality.js) に `BLOCKER_TOKENS` / `WARNING_TOKENS` 分離
- 新規 API: `POST /api/discovery/jobs/{id}/regenerate` (Team-A 協力)
- `src/api/marketLens.js` に `regenerateDiscoverySections(jobId, sections)` 追加
- [ReportQualityBadge.jsx](src/components/report/ReportQualityBadge.jsx) の `onRegenerate` を新API経由に

#### PR F-03: 参考観測枠 opacity降格 + 欠損セル明示
- [CompetitorMatrixV2.jsx](src/components/report/v2/CompetitorMatrixV2.jsx): `isReference` フラグで opacity 0.55
- 欠損セル: 斜線ハッチ + 「評価保留（データ不足）」バッジ
- Envelope スキーマに `role: "reference" | "competitor" | "brand"` を追加（Team-A 協力）

#### PR F-04: Radar 重ね描き
- [BrandRadarV2.jsx](src/components/report/v2/BrandRadarV2.jsx): Chart.js radar で最大4ブランドを塗り重ね
- 参考観測枠は破線 + fill-opacity 0.12
- 凡例: pillトグル（クリックでdataset hidden）

#### PR F-05: 発見LP一覧の「分析する」遷移先改善
- [DiscoveredLpGrid.jsx](src/pages/discovery/DiscoveredLpGrid.jsx) で `<Link to={`/compare?seed=${encodeURIComponent(item.url)}`}>` に変更
- 外部リンクは別ボタン（アイコンのみ）として併存

#### PR F-06: KPI空状態 + フォント拡張 + LPサムネイル統一
- KPI 0件時の「再生成」CTA
- `MarkdownRenderer` のフォントサイズ props を table / card 内にも伝播
- `DomainPlaceholder` を Botanical Green 統一トーン

#### PR F-07: v1 削除（最終PR）
削除対象: [src/components/report/](src/components/report/) 配下の v1 専用ファイル群（PriorityActionHero/CompetitorMatrix/BrandRadarChart/MarketRangeBar/reportTheme.js/JudgmentBadge）と `UiVersionToggle` / `useUiVersion.js`。

---

## 4. Stitch2 投入用プロンプト（UI/UX刷新）

Stitch2 で Figma → JSX 生成する際の**完成版プロンプト**。既存 [plans/ui-ux-zazzy-peacock.md](plans/ui-ux-zazzy-peacock.md) の Stitch2 v3 ブリーフを本プラン仕様に合わせて更新。

**Stitch2への指示テキスト** は [`plans/1-ui-ux-vast-phoenix-stitch2-prompt.md`](plans/1-ui-ux-vast-phoenix-stitch2-prompt.md) に別ファイルで格納予定（プラン承認後にWrite）。主要ブロック：

```
# Insight Studio Discovery Hub — V3 Redesign Brief

## Design North Star
- stitch2/ads-pack-executive-summary/DESIGN.md "The Living Editorial" 準拠
- No-line rule: tonal layering via surface_container_*
- Radius 16(card) / 12(button), Manrope display + Inter body
- Primary #003925 (Botanical Green), Accent #d4a843 (Gold), BG #fafaf5
- 禁止: 純黒, 純gray, bright blue, 標準drop-shadow, amber alert

## Scope
改修対象コンポーネント（src/components/report/v2/):
- ReportViewV2 (layout + sticky TOC)
- PriorityActionHeroV2 (gold gradient hero)
- CompetitorMatrixV2 (axis=row, brand=col, reference opacity降格)
- BrandRadarV2 (4ブランド重ね描き)
- MarketRangeV2 (low-confidence マスキング)
- DiscoveredLpGrid (統一サムネイル)
- MetaBand (signal hierarchy)

不可侵: tokens.css / print.module.css / v1レガシーコード

## 7つのUX原則
1. 1画面1勝ち筋 (Hero に唯一のトップアクション)
2. 比較は横並び、深掘りは縦送り
3. 信頼度は色+記号+ドット (color-blind safe)
4. Overview/Insight/Detail の3階層
5. 欠損は動線化 (警告→再生成CTA)
6. 参考観測枠は視覚降格 (opacity 0.55 + italic + dashed)
7. データカバレッジは編集的ヒートマップ

## 具体的デルタ (scroll screenshot の各問題に対応)
- MetaBand: プライマリ "N社比較 · データ信頼度 X%" (Manrope 28/700)
- PriorityActionHero: 金色グラデ背景で 3施策カードを横並び
- CompetitorMatrix: 参考観測枠の列を opacity 0.55 + italic、データ不足セルは斜線ハッチ + バッジ
- BrandRadarV2: Chart.js radar で最大4ブランド fill-opacity 0.25、参考観測は破線
- MarketRangeV2: 信頼度 low + range幅 10x超 で「推定根拠不足」カード
- DiscoveredLpGrid: 4:3統一サムネ、primary CTA "LP比較で深掘り" → /compare?seed=...
- Quality Banner: blocker=赤, warning=黄, admin-only chip=tertiary
- Sticky TOC: 左レール 200px @ ≥1280px

## Responsive
PC専用 (min 1024px), 1440+ は max-width 1400px centered

## Deliverables
1. Figma artboards (1440/1280/1024/Print/Dark)
2. 各コンポーネントの JSX (envelope + reportMd props 不変)
3. CSS Modules (tokens.css 継承)
4. Storybook stories (3/4ブランド、参考観測あり、欠損セル、low-confidence)
5. Playwright snapshots (fixture: 3brands/4brands/truncated)
```

**運用**:
1. Stitch2 にプロンプト + 現状スクリーンショット13枚(Before) + DESIGN.md(Guardrails) + 既存v2 6コンポーネント(参照)を渡す
2. Figma export をユーザー承認
3. 実装時は `v3` suffix で新規追加 → `F-07` で v1/v2 を置換
4. 実装後、`ui-design-review` skill で最終チェック

---

## 5. 実装順序・依存関係

```
Phase 0
  └─ codex-review (本プラン)  ← 現在地

Phase 1 (Team-A、直列、1日)
  ├─ PR B-01 (attempt_index bug)
  └─ PR Q-01 (auto regenerate)

Phase 2 (Team-A、並列、2-3日)              || Phase F前半 (Team-B、並列、2-3日)
  ├─ PR B-02 (search pool)                 ├─ PR F-01 (Discovery.jsx 分割)
  ├─ PR B-04 (prompt threshold)             └─ (F-01完了後に他F実装開始)
  ├─ PR B-05 (token budget 4sites)
  └─ PR Q-02 (compact threshold)

Phase 3 (Team-A、直列、1日)                || Phase F後半 (Team-B、並列、3-5日)
  ├─ PR B-03 (env 4sites + timeout)         ├─ PR F-02 (警告/CTA, B-06 APIと結合)
  └─ PR Q-03 (two-phase for 4+)              ├─ PR F-03 (参考観測降格)
                                              ├─ PR F-04 (Radar重ね描き)
Phase 4 (Team-A、ユーザー承認後、1日)        ├─ PR F-05 (分析するボタン)
  └─ PR B-06 (LLM validator)                 └─ PR F-06 (空状態/フォント/サムネ)

Phase Final (Team-B、1日)
  └─ PR F-07 (v1削除)

Phase Release (Team-C)
  ├─ market-lens-release-check
  └─ 本番デプロイ (render.yaml sync確認)
```

---

## 6. 検証手順

### 6-1. Unit tests（各PR内で必須）
```bash
# Backend
cd backends/market-lens-ai && python -m pytest tests/test_discovery_pipeline.py tests/test_analyzer.py -v

# Frontend
npm run test
npm run build
```

### 6-2. Integration（Phase完了時）
- `POST /api/ml/discovery/jobs` をペタビットURLで叩き、`competitors.length >= 3` / `candidate_pool_size >= 8` / `truncation_notice == null` を確認
- Phase 3 完了後は実競合比較対象が **2〜3社** に増えていることを確認

### 6-3. UI目視確認（Phase F の各PR）
使用skill: **`webapp-testing`** + **`devtools-verify`**（ゲストモード必須）
```
1. /discovery に https://www.petabit.co.jp/ を入力して実行
2. 4分前後で完了、以下をチェック:
   - 実競合比較対象が2〜3社表示
   - Section 5 が5-2検索広告施策の「初回KPI」列まで完走
   - COMPETITOR MATRIX で参考観測枠が opacity 0.55、斜線ハッチ
   - BRAND RADAR で3-4社ポリゴン重ね描き
   - 発見LP一覧の「分析する」が /compare?seed=... へ遷移
   - blocker品質警告時に「Section 5 を再生成」CTAが動作
3. 隣接画面regression: /compare, /creative, /ads-insights
4. console error / network error ゼロ確認
```

### 6-4. デザインレビュー（Phase F 各PR後）
使用skill: **`ui-design-review`**
- Botanical Green / Gold アクセントのトーン準拠
- radius 16/12, Manrope+Inter, tonal layering の確認
- アクセシビリティ AA、focus ring、キーボード操作

### 6-5. リリース前最終チェック
使用skill: **`market-lens-release-check`**
- render.yaml のenv変数が frontend定数と整合
- Vercel rewrites の変更不要確認
- dbmigration なし確認

---

## 7. リスクと緩和策

| リスク | 確率 | 影響 | 緩和策 |
|--------|------|------|--------|
| 4サイト analyze で 300s 超過 | 中 | 全ジョブ失敗 | Degrade ladder (4→3→3haiku) が既存 |
| frontend `POLL_HARD_CEILING_MS` 更新忘れ | 中 | false timeout | B-03 同一PR内で frontend/backend同時更新（CIに lint ルール追加検討） |
| Sonnet 4.6 max_tokens < 14336 | 低 | B-05 がAPIエラー | `claude-api` skill で事前検証、NGなら 12288 に戻す |
| Haiku validator過負荷 | 中 | +12s遅延 | 既存 except fallback で heuristic ranking に戻る |
| Stitch2生成JSXと既存CSS Modulesの衝突 | 高 | UI崩れ | v3 suffix で別ファイル化 → F-07 で置換、v2 tokens.css は不可侵 |
| Phase1 と Phase F-01 の同時進行でマージ競合 | 中 | 手戻り | Team-A/Team-B は異なるディレクトリで作業、毎日 master pull |
| 本番デプロイ時の render.yaml 部分適用 | 低 | timeout不整合 | `market-lens-release-check` skill で事前検証 |

---

## 8. 変更対象ファイル一覧

### Backend（Team-A）
- [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py) — 中核パイプライン
- [backends/market-lens-ai/web/app/services/discovery/anthropic_search_client.py](backends/market-lens-ai/web/app/services/discovery/anthropic_search_client.py) — Search pool
- [backends/market-lens-ai/web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py) — token budget / prompt切替
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) — truncation notice
- [backends/market-lens-ai/web/app/routers/discovery_routes.py](backends/market-lens-ai/web/app/routers/discovery_routes.py) — candidate validator ON
- 新規: `backends/market-lens-ai/web/app/routers/discovery_regenerate.py`（Section5再生成API）
- 新規: `backends/market-lens-ai/web/app/services/discovery/candidate_validator.py`
- [render.yaml](render.yaml) — env変数
- 各種 `tests/` 追加

### Frontend（Team-B）
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx) → 分割後は `src/pages/discovery/Discovery.jsx`
- 新規: `src/pages/discovery/` 配下 7ファイル（F-01で抽出）
- [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx)
- [src/components/report/v2/CompetitorMatrixV2.jsx](src/components/report/v2/CompetitorMatrixV2.jsx)
- [src/components/report/v2/BrandRadarV2.jsx](src/components/report/v2/BrandRadarV2.jsx)
- [src/components/report/v2/MarketRangeV2.jsx](src/components/report/v2/MarketRangeV2.jsx)
- [src/components/report/v2/PriorityActionHeroV2.jsx](src/components/report/v2/PriorityActionHeroV2.jsx)
- [src/components/report/ReportQualityBadge.jsx](src/components/report/ReportQualityBadge.jsx)
- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) — フォントサイズ伝播
- [src/utils/reportQuality.js](src/utils/reportQuality.js) — severity分離
- [src/api/marketLens.js](src/api/marketLens.js) — regenerate API client
- [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js) — `role` field対応
- F-07 で削除: `src/components/report/` 配下 v1ファイル群（6ファイル）、`src/components/report/v2/UiVersionToggle.jsx`、`src/hooks/useUiVersion.js`

---

## 9. 再利用する既存コード

既存実装を活用して新規コード量を最小化する：
- [src/utils/brandEvalParser.js](src/utils/brandEvalParser.js) — `AXIS_KEYS` / `parseBrandVerdicts` で matrix/radar の単一ソース
- [src/utils/kpiExtractor.js](src/utils/kpiExtractor.js) — `extractKpis` / `extractMarketRanges`
- [src/utils/reportQuality.js](src/utils/reportQuality.js) — `splitIssuesBySeverity` (D-1 実装済)
- [src/contexts/AnalysisRunsContext.jsx](src/contexts/AnalysisRunsContext.jsx) — run state の既存共通化
- [src/contexts/BackendReadinessContext.jsx](src/contexts/BackendReadinessContext.jsx) — warming/ready 監視
- [src/contexts/RbacContext.jsx](src/contexts/RbacContext.jsx) — admin ガード
- [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css) — MD3 tokens（不可侵）
- [src/components/report/v2/ConfidencePill.jsx](src/components/report/v2/ConfidencePill.jsx) — verdict badge統一
- [src/components/report/PrintButton.jsx](src/components/report/PrintButton.jsx) — PDF preflight
- [src/test/mocks/contexts.js](src/test/mocks/contexts.js) — TestProviders（RbacProvider 済、commit `7cf32dd`）

---

## 10. ユーザー確認事項（着手前に合意したい）

| # | 問い | デフォルト提案 | 影響 |
|---|------|---------------|------|
| Q1 | 競合数目標 | **4サイト (ブランド+競合3)**、将来5へ段階拡大 | analyze timeout +40s |
| Q2 | Timeout延長 | overall 360→450s / analyze 240→300s | Render料金影響なし |
| Q3 | frontend POLL_HARD_CEILING_MS | 470_000 に同時更新 | B-03と同一PR |
| Q4 | LLM candidate validator 再有効化 (B-06) | 含める | +8〜12s、タナベ類の除外に有効 |
| Q5 | v1 削除タイミング | F-07 として本プラン完了と同時に削除 | 負債圧縮 |
| Q6 | Stitch2 投入タイミング | Backend Phase1-3完了後、Frontend F-01後 | 最もクリーン |
| Q7 | 末尾切り詰め時の挙動 | admin警告表示 / 非admin自動再生成 | 現行から変更 |

---

## 11. 想定スケジュール（工数目安）

| Phase | Team-A 工数 | Team-B 工数 | 累計 |
|-------|------------|------------|------|
| Phase 0 (計画書レビュー) | 0.5日 | 0.5日 | 0.5日 |
| Phase 1 (ブロッカー修正) | 1日 | - | 1.5日 |
| Phase 2 (準備層 + Phase F-01) | 2-3日 (並列) | 2-3日 (並列) | 4.5日 |
| Phase 3 (拡張本命 + Phase F後半) | 1日 (並列) | 3-5日 (並列) | 9.5日 |
| Phase 4 (LLM validator) | 1日 | - | 10.5日 |
| Phase Final (v1削除 + Release) | - | 1日 + 0.5日 | 12日 |

**累計 12日 / 2-2.5スプリント相当**（並列実行前提）

---

## 12. 参照する既存プラン

本プランは以下の既存検討資産を統合している：
- [plans/web-ai-ui-ux-polymorphic-umbrella.md](plans/web-ai-ui-ux-polymorphic-umbrella.md) — Discovery Hub品質改善プラン（I-1〜X-3, F-1〜F-7 Stitch2ブリーフ）
- [plans/ui-ux-zazzy-peacock.md](plans/ui-ux-zazzy-peacock.md) — 水栓金具EC Discovery CRITICAL + Stitch2 v3プロンプト
- [plans/2026-04-05-discovery-token-pressure-reduction-plan.md](plans/2026-04-05-discovery-token-pressure-reduction-plan.md) — token圧縮策
- [plans/cozy-splashing-tiger.md](plans/cozy-splashing-tiger.md) — wide/deep閾値の罠
- [plans/2026-04-11-claude-discovery-report-final-quality-plan-v3.md](plans/2026-04-11-claude-discovery-report-final-quality-plan-v3.md) — 発見候補と実分析対象の分離
- [plans/sports-supplement-report-quality-finalization-plan.md](plans/2026-04-11-sports-supplement-report-quality-finalization-plan.md) — 品質チェックを「表示」から「制御」へ

---

## 13. 承認後の最初のアクション

ユーザー承認（§10）を得た後の最初のコマンド：
```
1. codex-review skill で本プランを厳格レビュー (Critical/Major 0 まで修正ループ)
2. Phase 1 (PR B-01) 着手 → Team-A 単独作業 → market-lens-backend-guardrails でレビュー
3. 並行で Phase F-01 (Discovery.jsx 分割) 着手 → Team-B 単独作業 → market-lens-frontend-review でレビュー
```
