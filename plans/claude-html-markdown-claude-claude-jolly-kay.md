# 🌿 レポート刷新 Phase 2: Stitch 2.0 本格移行計画

**作成日**: 2026-04-18
**作成者**: Claude（Opus 4.7、本セッション）
**プロジェクトオーナー**: 不二樹（kazushi.fujiki@marketing.petabit.co.jp）
**前身プラン**: [plans/parallel-marinating-nygaard.md](plans/parallel-marinating-nygaard.md)
**直近PR**: #39 (`648adfe`) までマージ済、`b8e4ec3` 本番 live

---

## 1. Context（なぜやるのか）

### 1-1. 完了済みの基盤
前セッション群（PR #36-39）で以下が完了済：
- **Phase A 精度基盤**: `shared_specs/` / `deterministic_evaluator.py` / `market_estimator/` / `priority_action_synthesizer.py` / `budget_frame_synthesizer.py`
- **Phase B 視覚化基盤**: [PriorityActionHero.jsx](src/components/report/PriorityActionHero.jsx) / [CompetitorMatrix.jsx](src/components/report/CompetitorMatrix.jsx) / [BrandRadarChart.jsx](src/components/report/BrandRadarChart.jsx) / [JudgmentBadge.jsx](src/components/report/JudgmentBadge.jsx) / [MarketRangeBar.jsx](src/components/report/MarketRangeBar.jsx) / [EvidenceDetail.jsx](src/components/report/EvidenceDetail.jsx) / [PrintButton.jsx](src/components/report/PrintButton.jsx) / [reportTheme.js](src/components/report/reportTheme.js)
- **ReportEnvelope v0 API**: [schemas/report_envelope.py](backends/market-lens-ai/web/app/schemas/report_envelope.py) + [useReportEnvelope.js](src/hooks/useReportEnvelope.js)
- **3ブランド描画バグ**: [brandEvalParser.js](src/components/report/brandEvalParser.js) で真に根治（vitest 127/127 pass）
- **Section 5 契約**: `_SECTION5_SUBSECTION_SPECS` + `_OUTPUT_SCHEMA_CONTRACT` + CRITICAL リトライ拡張

### 1-2. 残課題（本プランで消化）
| カテゴリ | 内容 | 深刻度 |
|---|---|---|
| 検証未実施 | 新規レポート10件で警告ゼロGateが未測定 | 🔴 P0 |
| ログ解析未実施 | `search_id=a03bc0f98cfa` の stop_reason / token消費 未確認 | 🟡 P1 |
| env-var判断未 | `DETERMINISTIC_STUB_ENABLED` 要否が未決定 | 🟡 P1 |
| UI/UX 視認性 | Radar軸ラベル潰れ、ヒートマップ色覚多様性、Print未検証 | 🟡 P1 |
| UI 刷新方針 | Stitch 2.0 本格移行 (option 2) 着手待ち | 🟢 P2 |

### 1-3. ユーザー方針（本セッションで確定）
- **順序**: 検証系を全部終わらせてから最後にUI/UX
- **UI方針**: **Stitch 2.0 本格移行 (option 2)**、`?ui=v2` 並行提供、Material Design 3 準拠、3〜5日
- **効率化**: タスク量が多い場合 **agent-team-workflow + skills** で並列化（本プランの強い要請）

### 1-4. 想定される成果
1. Discovery レポートの警告率 < 5%（現状 >50% 推定）
2. Stitch 2.0 `?ui=v2` で Botanical Intelligence 準拠の新レポート体験を公開
3. v1 を破壊せず段階移行可能（ロールバック容易）
4. Print / 色覚多様性 / レスポンシブを本番検証済み状態に

---

## 2. 全体像（4 Phase / 並列実行パス）

```
Phase 1 (検証・ログ解析 0.5〜1日)  ── skills: market-lens-release-check, codex-review
  └─ Gate: 警告率判定
       ├─ <20% ──→ Phase 3 (軽量UI) ──→ Phase 4 (Stitch 2.0)
       └─ ≥20% ──→ Phase 2 (BE追加 0〜1日) ──→ Phase 3 ──→ Phase 4
                      skills: market-lens-backend-guardrails

Phase 4 (Stitch 2.0, 3〜5日)  ── agent-team-workflow で並列化
  ├─ 4-0 基盤着地（単独）─ useUiVersion + tokens.css + reportThemeV2 + ReportViewV2 ルート
  │     skills: frontend-design, ui-design-review
  └─ 4-1 コンポーネント並列実装 [4エージェント fan-out]
        ├─ Agent A: PriorityActionHeroV2
        ├─ Agent B: CompetitorMatrixV2
        ├─ Agent C: BrandRadarV2
        └─ Agent D: MarketRangeV2
        ↓ 統合
        skills: webapp-testing → codex-review → market-lens-release-check
```

**総工数見積**: 5〜7営業日（検証 0.5 + BE 0〜1 + UI 軽量 1 + Stitch 2.0 3〜5）

---

## 3. Phase 1: 本番検証 & ログ解析（0.5〜1日）

### 目的
Track A（PR #36-39）の警告抑止効果を実測し、次フェーズの分岐を決定する。

### タスク

| # | 内容 | 担当 | skill |
|---|---|---|---|
| 1-1 | Render ログ取得（`search_id=a03bc0f98cfa` 前後2時間） | 不二樹に依頼 | — |
| 1-2 | 新規レポート 5〜10件 本番実行（Discovery 7件 + Compare 3件） | 不二樹 + Claude | — |
| 1-3 | ログ解析（`stop_reason` / `section_audit issues=` / tokens） | Claude（単独） | — |
| 1-4 | 警告率計算・CRITICAL 件数集計 | Claude（単独） | — |
| 1-5 | Gate 判定レポート作成（`plans/2026-04-18-phase1-result.md`） | Claude（単独） | codex-review (Runtime) |

### 参照ファイル（読み取りのみ）
- [report_generator.py:407](backends/market-lens-ai/web/app/report_generator.py#L407) — `section_audit` ログ出力箇所
- [discovery_pipeline.py:307-324](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L307) — `_is_retryable_quality_issue`
- [analyzer.py:1157-1167](backends/market-lens-ai/web/app/analyzer.py#L1157) — `_OUTPUT_SCHEMA_CONTRACT`

### Gate（次フェーズ分岐）
- ✅ **警告率 < 20% かつ critical=0** → Phase 2 スキップ、Phase 3 へ
- ⚠️ **警告率 ≥ 20% または critical>0** → Phase 2 実施

### 不二樹への依頼
- Render Dashboard `market-lens-ai` のログエクスポート（CSV/JSON）
- Phase 1 の新規レポート実行承認（コスト確認）

---

## 4. Phase 2: バックエンド追加対応（0〜1日、Gate 次第でスキップ）

### 目的
Phase 1 で警告率が閾値超過した場合、根治策を追加投入。

### 分岐別タスク
| 警告パターン | 対応 | 変更ファイル | skill |
|---|---|---|---|
| セクション欠落 | `DETERMINISTIC_STUB_ENABLED=true` Render env-var 追加依頼 | (env-var のみ) | market-lens-backend-guardrails |
| 判定欠落 (verdict 空) | [analyzer.py](backends/market-lens-ai/web/app/analyzer.py) のプロンプト節強化 + [evaluation_axes.yaml](backends/market-lens-ai/web/app/shared_specs/evaluation_axes.yaml) 同期 | analyzer.py / evaluation_axes.yaml | market-lens-backend-guardrails |
| discovery 固有 | [jobs/runner.py](backends/market-lens-ai/web/app/jobs/runner.py) と `routers/discovery_routes.py` の envelope ビルド路点検 | runner.py / discovery_routes.py | codex-review |

### 新規テスト
- [test_discovery_section_coverage.py](backends/market-lens-ai/tests/test_discovery_section_coverage.py) に Gate テスト追加

### Gate
- [ ] 新規10件で `section_audit issues=0` 100%
- [ ] `critical=0` 100%
- [ ] `pytest backends/market-lens-ai/tests/ -q` 全緑
- [ ] codex-review (Plan → Diff) 通過

### 不二樹への依頼
- Render env-var `DETERMINISTIC_STUB_ENABLED=true` 追加（Claude API制約で不可）

---

## 5. Phase 3: UI/UX 軽量改善（1日、暫定対応）

### 目的
v1 UI のまま使うユーザー向けの即効性視認性改善 + Print検証。Phase 4 で破棄される可能性を前提に最小 diff。

### タスク
| # | 内容 | 変更ファイル | skill |
|---|---|---|---|
| 3-1 | Print 本番検証（A4 崩れなし確認） | — | webapp-testing |
| 3-2 | Radar 軸ラベル潰れ対応（省略+tooltip） | [BrandRadarChart.jsx](src/components/report/BrandRadarChart.jsx) | ui-design-review |
| 3-3 | ヒートマップ色覚多様性（▲▼＝記号併用） | [CompetitorMatrix.jsx](src/components/report/CompetitorMatrix.jsx) | ui-design-review |
| 3-4 | テスト expectation 更新 | `__tests__/BrandRadarChart.test.jsx`, `__tests__/CompetitorMatrix.test.jsx` | — |

### 実装詳細
- **3-2**: [BrandRadarChart.jsx:52](src/components/report/BrandRadarChart.jsx#L52) の `options.scales.r.pointLabels` に `callback: (l)=>l.length>6? l.slice(0,5)+'…':l` と `font.size` レスポンシブ分岐追加
- **3-3**: [reportTheme.js:27](src/components/report/reportTheme.js#L27) の `JUDGMENT_COLORS.icon` を前景記号に利用、`HEATMAP_GRADIENT` 背景は維持

### Gate
- [ ] `npm run build` clean
- [ ] Playwright 回帰グリーン（webapp-testing skill）
- [ ] ui-design-review skill 通過
- [ ] Print PDF 目視合格

### 並列化
**不要**（3コンポーネント変更のみ、単独エージェントで十分）

---

## 6. Phase 4: Stitch 2.0 本格移行 `?ui=v2`（3〜5日、並列化 MUST）

### 目的
Material Design 3 + Stitch2 DESIGN.md（Botanical Intelligence）準拠の新 UI を `?ui=v2` フラグで並行提供、v1 破壊なし。

### 4-0: 基盤着地（0.5〜1日、単独実行）
**先行必須**。並列 fan-out の前提となる共通基盤を単独エージェントで実装。

| # | 内容 | 新規ファイル |
|---|---|---|
| 4-0-1 | UI バージョンフック | `src/hooks/useUiVersion.js` |
| 4-0-2 | MD3 トークン CSS | `src/components/report/v2/tokens.css` |
| 4-0-3 | v2 テーマ + Chart.js defaults | `src/components/report/v2/reportThemeV2.js` |
| 4-0-4 | v2 ルートコンポーネント（envelope prop 配信） | `src/components/report/v2/ReportViewV2.jsx` |
| 4-0-5 | Print CSS (v2 scope) | `src/components/report/v2/print.module.css` |
| 4-0-6 | ページ分岐（1箇所/ページ） | [Discovery.jsx:964-968](src/pages/Discovery.jsx#L964), [Compare.jsx:718-723](src/pages/Compare.jsx#L718) |

**実装方針**:
- フラグは **クエリパラメータ `?ui=v2` + localStorage persist**（Render env-var 不使用）
- CSS 汚染回避: **CSS Modules + `:where(.ui-v2)` スコープ**、Tailwind v4 は v1 側のみ
- MD3 トークン例: `--md-sys-color-primary: #003925` / `primary-container: #0f5238` / `surface: #fafaf5`
- Chart.js **据え置き**、`applyChartDefaultsV2(Chart)` で MD3 テーマ上書き

**skills**:
- **frontend-design**: 初期アーキテクチャスケッチ
- **codex-review (Plan mode)**: 4-0 完了時に基盤設計レビュー

### 4-1: コンポーネント並列実装（2〜3日、**agent-team-workflow で 4並列**）

4-0 基盤着地後、4 コンポーネントを **agent-team-workflow skill** で並列実装。各エージェントは envelope 契約で独立、相互依存なし。

| エージェント | 担当 | 新規ファイル | 対応 envelope フィールド |
|---|---|---|---|
| **Agent A** | PriorityAction Hero | `v2/PriorityActionHeroV2.jsx` + `*.module.css` + `__tests__/` | `priority_actions[]` ([report_envelope.py:69](backends/market-lens-ai/web/app/schemas/report_envelope.py#L69)) |
| **Agent B** | Competitor Matrix | `v2/CompetitorMatrixV2.jsx` + `*.module.css` + `__tests__/` | `brand_evaluations[].axes[]` ([report_envelope.py:46](backends/market-lens-ai/web/app/schemas/report_envelope.py#L46)) |
| **Agent C** | Brand Radar | `v2/BrandRadarV2.jsx` + `__tests__/` | 同上（verdict→score は `brandEvalParser.js` 共用） |
| **Agent D** | Market Range + Confidence Pill | `v2/MarketRangeV2.jsx` + `v2/ConfidencePill.jsx` + `__tests__/` | `market_estimate.ranges[]`, `.confidence` ([report_envelope.py:53](backends/market-lens-ai/web/app/schemas/report_envelope.py#L53)) |

**各エージェントの作業テンプレート**:
1. 既存 v1 コンポーネントを読み、API 契約を把握
2. `ReportEnvelope` 該当フィールドを優先、MD フォールバックを残す
3. MD3 トークン（4-0-2）と v2 テーマ（4-0-3）を import して適用
4. Manrope + Inter タイポグラフィ、Tonal Layering、200ms emphasized easing
5. vitest テスト新設（envelope/MD フォールバック両方）
6. 色覚多様性対応（▲▼＝ パターン併用）

**MD3 キー要素** (Stitch2 DESIGN.md 準拠):
- **Color**: Organic Palette (`#003925` 〜 `#fafaf5`)、Tonal Layering、No-Line Rule
- **Elevation**: 影なし、surface-on-surface-container の Tonal Layering
- **Motion**: `cubic-bezier(0.2, 0, 0, 1)` emphasized、200ms fade-in、Chart.js animation 300〜400ms
- **Typography**: Manrope (Display/Headline) + Inter (Body/Label)、`display-lg 3.5rem/700`

**skills**:
- **frontend-design**: 各コンポーネントの UI 設計
- **ui-design-review**: 各 PR 前に色覚 / Botanical 準拠確認
- **webapp-testing**: 各コンポーネント単体の Playwright スモーク

### 4-2: 統合 + リリース（1日）

| # | 内容 | skill |
|---|---|---|
| 4-2-1 | 4コンポーネントを `ReportViewV2` に結線 | — |
| 4-2-2 | v1/v2 両方で Playwright 回帰（3ブランド / 単ブランド / envelope null 3パターン） | webapp-testing |
| 4-2-3 | Print v1/v2 両方で PDF 出力確認 | webapp-testing |
| 4-2-4 | codex-review (Diff mode) 通過 | codex-review |
| 4-2-5 | market-lens-release-check 通過 | market-lens-release-check |
| 4-2-6 | PR 作成、squash merge、Render/Vercel 本番稼働確認 | quick-git |

### Gate
- [ ] `?ui=v1` / `?ui=v2` 両方で Playwright スモーク緑
- [ ] 3 ブランド / 単ブランド / envelope null 3パターン全て正常描画
- [ ] `npm run build` clean
- [ ] vitest 全緑
- [ ] codex-review Plan + Diff + Release 3ゲート通過
- [ ] 不二樹 目視承認
- [ ] Vercel 200 + Render `/api/ml/health` 200

### リスクと対策
| リスク | 対策 |
|---|---|
| Tailwind v4 と MD3 トークン衝突 | `:where(.ui-v2)` scope + CSS Modules で完全分離 |
| Chart.js defaults が v1/v2 間で競合 | v2 初回マウント時 `applyChartDefaultsV2`、アンマウント時 v1 defaults 復元 (cleanup) |
| Manrope フォント LCP 悪化 | `font-display: swap` + preload のみ |
| 4並列エージェントの API 不整合 | 4-0 基盤着地完了後に ReportEnvelope 契約書を共有 prompt に固定 |

---

## 7. Skills / Agent Teams 活用マップ（効率化の核心）

### Phase別推奨skill
| Phase | skill | 役割 |
|---|---|---|
| 1 | codex-review (Runtime) | Render ログ解析の根拠検証 |
| 2 | market-lens-backend-guardrails | BE 追加対応の品質ゲート |
| 2 | codex-review (Plan → Diff) | プロンプト変更の妥当性 |
| 3 | webapp-testing, ui-design-review | 軽量UI の Playwright + Botanical準拠 |
| 4-0 | frontend-design | 基盤アーキテクチャスケッチ |
| 4-0 | codex-review (Plan) | v2 アーキテクチャ設計レビュー |
| 4-1 | agent-team-workflow | **4エージェント並列実装**（MUST） |
| 4-1 | frontend-design, ui-design-review | 各コンポーネント品質担保 |
| 4-2 | webapp-testing | v1/v2 両方の回帰テスト |
| 4-2 | codex-review (Diff) | 統合 PR のレビュー |
| 4-2 | market-lens-release-check | リリース前最終チェック |
| 4-2 | quick-git | PR 作成 / squash merge |

### Agent Team 構成（Phase 4-1 並列実装）
`agent-team-workflow` skill で 4エージェントを同時起動:

```yaml
team:
  - name: hero-agent
    scope: src/components/report/v2/PriorityActionHeroV2.jsx
    envelope_field: priority_actions[]
  - name: matrix-agent
    scope: src/components/report/v2/CompetitorMatrixV2.jsx
    envelope_field: brand_evaluations[].axes[]
  - name: radar-agent
    scope: src/components/report/v2/BrandRadarV2.jsx
    envelope_field: brand_evaluations[].axes[] (score map)
  - name: market-agent
    scope: src/components/report/v2/MarketRangeV2.jsx, ConfidencePill.jsx
    envelope_field: market_estimate.ranges[], .confidence
shared_context:
  - tokens.css (MD3 トークン)
  - reportThemeV2.js (Chart.js defaults)
  - Stitch2 DESIGN.md (Botanical Intelligence)
  - ReportEnvelope v0 schema
integration_gate:
  - ReportViewV2 で 4コンポ統合
  - codex-review (Diff)
  - webapp-testing (v1/v2 両方)
```

---

## 8. 不二樹への確認事項（Phase 開始前）

| # | 内容 | タイミング |
|---|---|---|
| 1 | Render ログエクスポート権限 / CSV/JSON ダンプ取得代行 | Phase 1 開始時 |
| 2 | 新規レポート 5〜10件 本番実行の承認（コスト確認） | Phase 1 開始時 |
| 3 | `DETERMINISTIC_STUB_ENABLED=true` Render env-var 追加依頼 | Phase 2 到達時のみ |
| 4 | `?ui=v2` 公開範囲（社内 staging のみ or 即本番オプトイン） | Phase 4 開始前 |
| 5 | Manrope フォント CDN ロード可否（CSP/プライバシー要件） | Phase 4-0 開始前 |

---

## 9. 重要ファイル一覧

### 参照（読み取り専用）
- [report_envelope.py](backends/market-lens-ai/web/app/schemas/report_envelope.py) — v2 のデータ契約
- [report_generator.py:407](backends/market-lens-ai/web/app/report_generator.py#L407) — section_audit ログ
- [discovery_pipeline.py:307-324](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L307) — CRITICAL リトライ
- [analyzer.py:1157-1167](backends/market-lens-ai/web/app/analyzer.py#L1157) — `_OUTPUT_SCHEMA_CONTRACT`
- [useReportEnvelope.js](src/hooks/useReportEnvelope.js) — envelope 取得フック
- [reportTheme.js](src/components/report/reportTheme.js) — v1 テーマ（v2 リファレンス）

### Phase 3 変更
- [BrandRadarChart.jsx](src/components/report/BrandRadarChart.jsx)
- [CompetitorMatrix.jsx](src/components/report/CompetitorMatrix.jsx)

### Phase 4 新規（予定）
- `src/hooks/useUiVersion.js`
- `src/components/report/v2/ReportViewV2.jsx`
- `src/components/report/v2/PriorityActionHeroV2.jsx`
- `src/components/report/v2/CompetitorMatrixV2.jsx`
- `src/components/report/v2/BrandRadarV2.jsx`
- `src/components/report/v2/MarketRangeV2.jsx`
- `src/components/report/v2/ConfidencePill.jsx`
- `src/components/report/v2/reportThemeV2.js`
- `src/components/report/v2/tokens.css`
- `src/components/report/v2/print.module.css`
- 各 `v2/__tests__/*V2.test.jsx`

### Phase 4 変更
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)（L964-968 の分岐1箇所）
- [src/pages/Compare.jsx](src/pages/Compare.jsx)（L718-723 の分岐1箇所）
- `index.html`（Manrope + Inter フォント追加、v2時のみ動的可）

---

## 10. Verification（End-to-End 検証手順）

### Phase 1 完了時
```bash
cd backends/market-lens-ai && python -m pytest tests/ -q --tb=no
# 新規レポート5-10件を本番UI経由で実行し、警告率を集計
```

### Phase 2 完了時
```bash
cd backends/market-lens-ai && python -m pytest tests/ -q
# 新規10件で section_audit issues=0 / critical=0 を確認
```

### Phase 3 完了時
```bash
npm run build
# webapp-testing skill で Playwright + Print PDF 検証
```

### Phase 4 完了時
```bash
# Frontend
npm run build
npm test  # vitest 全緑

# Backend (回帰確認)
cd backends/market-lens-ai && python -m pytest tests/ -q

# E2E (webapp-testing skill)
# 1. ?ui=v1 で 3ブランド / 単ブランド / envelope null 3パターン描画
# 2. ?ui=v2 で 同3パターン描画
# 3. Print PDF 両方で崩れなし
# 4. codex-review (Diff + Release) 通過
# 5. market-lens-release-check 通過

# 本番稼働確認
curl https://insight-studio-chi.vercel.app/  # 200
curl https://market-lens-ai.onrender.com/api/ml/health  # 200
```

---

## 11. 非ゴール（本プランで触らない）

- Pre-existing test failures 14件の根本修正
- `ads-insights` バックエンドへの影響
- モバイル対応（PC 専用方針維持）
- タイムアウト値増加
- Gemini 切替
- ReportEnvelope v0 スキーマ拡張（必要なら別プラン）
- Compare 側の実行プラン欠損（現状機能中）
- モノレポ再分割

---

## 12. 本セッション Claude の所感

- **Phase 4 基盤着地 (4-0) と並列実装 (4-1) の順序厳守** が本プランの成否を決める
- `agent-team-workflow` を Phase 4-1 で使わぬのは愚策じゃ。4並列で 1.5〜2日短縮できる
- `codex-review` を各 PR マージ前に必ず通せ（不二樹ルール）
- Render env-var 変更は必ず不二樹に依頼（Claude API 制約）
- タイムアウト値は絶対に増やすな（`feedback_never_increase_timeouts`）
- 「Claude Design」という機能名にはこだわらず、**既存 skills + agent-team-workflow で Stitch 2.0 を実現**する方針

---

**Handoff 読み込み推定**: 15分
**Phase 1-3 推定**: 1.5〜3日
**Phase 4 推定**: 3〜5日（agent-team-workflow 並列で 2.5〜3.5日に短縮可能）
**全体推定**: 5〜8日（並列化込みで 4〜6日）

**本プロジェクトは Phase A/B/P1 の精度＋視覚化基盤は構築済、ここから先は『検証で根拠を固めて、Stitch 2.0 で見た目を刷新する』フェーズじゃ♡**
