# 🌿 Phase 5B: 実データ E2E による Stitch 2.0 v2 検証

**作成日**: 2026-04-18
**作成者**: Claude（Opus 4.7、本セッション）
**プロジェクトオーナー**: 不二樹（kazushi.fujiki@marketing.petabit.co.jp）
**前身プラン**: `plans/2026-04-18-phase5a-stitch-v2-browser-verification-plan.md`
**対象ベースコミット**: `a084d3c` (PR #41 マージ済)

---

## 1. Context（なぜやるのか）

### 1-1. 完了済み（PR #36-41）
| Phase | 内容 | PR |
|---|---|---|
| A 精度基盤 | shared_specs / deterministic_evaluator / market_estimator 他 | #36 |
| Hero 検出整合 | PriorityActionHero keyword alignment | #37 |
| Section 5 契約 | `_SECTION5_SUBSECTION_SPECS` + CRITICAL retry + deterministic stubs | #38 |
| Schema 契約 + 3ブランドバグ | `_OUTPUT_SCHEMA_CONTRACT`, `brandEvalParser.js` 根治 | #39 |
| Stitch 2.0 v2 scaffold | `?ui=v2` 並行提供、MD3 トークン、5 コンポーネント v2 化 | #40 |
| Phase 5A empty state 検証 | 6 パターン PASS、Vitest 153/153、Print PDF + responsive | #41 |

### 1-2. Phase 5A で明示的に未達の点
PR #41 は **empty state 限定**の検証じゃった。`ReportViewV2` は `result` が揃った時のみマウントされる設計ゆえ、以下が未確認：

- v2 コンポーネント群（PriorityActionHeroV2 / CompetitorMatrixV2 / BrandRadarV2 / MarketRangeV2 / ConfidencePill）の**実描画**
- envelope あり／MD fallback 両パターンでの v2 レイアウト整合
- 実データ下での Print PDF（`break-inside: avoid` の効き目）
- 実データ下での Matrix 横スクロール閾値、Radar `font-size` 落ち分岐

### 1-3. Medium 課題（PR #41 report §6）
| # | 内容 | 本プランで扱うか |
|---|---|---|
| 1 | `tokens.css` の `@theme` dead block → `:root {}` 整理 | ✅ 同梱 |
| 2 | 実データ E2E 未達 | ✅ **本プランの主目的** |
| 3 | Manrope/Inter フォント link | ✅ 解消済（index.html:8） |

### 1-4. 想定される成果
1. v2 報告書本体（5 コンポーネント）の**実描画**を本番相当環境で視認済にする
2. envelope あり／null 両パターンを Playwright スクリプトで網羅
3. v2 デフォルト昇格の定量根拠（Critical/High 0 確認）を得る
4. `tokens.css` の dead `@theme` を解消し、lightningcss warning を消す

---

## 2. 全体像

```
Phase 5B (本プラン, 0.5〜1日)
├─ 5B-0 準備: 実データ search_id 取得 (不二樹 or Claude)
├─ 5B-1 Playwright 拡張: scripts/phase5b-verify.py 新設
│        ├─ Pattern G: /discovery/result?search_id=<id>&ui=v1 (回帰確認)
│        ├─ Pattern H: /discovery/result?search_id=<id>&ui=v2 (v2 実描画)
│        ├─ Pattern I: /compare/result?search_id=<id>&ui=v2 (Compare v2)
│        └─ Pattern J: envelope null 強制 (MD fallback 実描画確認)
├─ 5B-2 tokens.css @theme cleanup
└─ 5B-3 Gate 判定 + result.md 作成 + PR

Gate OK ──→ Phase 5C (v2 default promotion, 別PR)
```

**総工数見積**: 0.5〜1 営業日

---

## 3. Phase 5B-0: 実データ search_id 準備（0.1 日）

### 目的
Phase 5A で使えなかった「完了済ジョブの `search_id`」を用意し、v2 UI を本物のレポートで描画させる。

### 選択肢

| 案 | 内容 | 所要 | 備考 |
|---|---|---|---|
| α | 既存の `a03bc0f98cfa`（カメラの大林）を再利用 | 0 分 | envelope 互換性を先に確認 |
| β | 新規 Discovery ジョブを本番実行 | 10-20 分 | コスト発生、不二樹承認必要 |
| γ | staging で Discovery ジョブ実行 | 同上 | 本番影響なし |

**推奨**: まず α を試し、envelope 未対応なら β（不二樹承認後）。

### 参照ファイル（読み取りのみ）
- [src/pages/Discovery.jsx:971-982](src/pages/Discovery.jsx#L971-L982) — v1/v2 分岐
- [src/pages/Compare.jsx:724-737](src/pages/Compare.jsx#L724-L737) — v1/v2 分岐
- [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js) — envelope fetch
- [backends/market-lens-ai/web/app/schemas/report_envelope.py](backends/market-lens-ai/web/app/schemas/report_envelope.py) — 契約

### 不二樹への依頼
- β/γ 採用時: 本番または staging で Discovery ジョブ 1-2 件の実行承認

---

## 4. Phase 5B-1: Playwright 実データ検証（0.3 日、skill: webapp-testing）

### 目的
`ReportViewV2` をマウントさせ、v2 コンポーネント群を視覚・構造の両面で検証する。

### 新規ファイル
- `scripts/phase5b-verify.py` — Phase 5A スクリプトの拡張版（再現可能）

### 検証パターン（G〜J、4パターン）

| # | URL | 目的 |
|---|---|---|
| G | `/discovery/result?search_id=<id>&ui=v1` | v1 回帰確認（baseline） |
| H | `/discovery/result?search_id=<id>&ui=v2` | **v2 実描画メイン検証** |
| I | `/compare/result?search_id=<id>&ui=v2` | Compare 側 v2 実描画 |
| J | `/discovery/result?search_id=<id>&ui=v2` + envelope モック null | MD fallback 動作確認 |

### 各パターンの確認項目（v2 共通）

**存在確認**:
- [ ] `<div class="ui-v2">` ルートが DOM に存在
- [ ] `PriorityActionHeroV2` カード（`data-testid` or `.priorityActionHeroV2` など既存 class）
- [ ] `CompetitorMatrixV2` テーブル（セルに `▲/＝/▼` 記号）
- [ ] `BrandRadarV2` canvas（Chart.js）
- [ ] `MarketRangeV2` バー
- [ ] `ConfidencePill` バッジ

**テーマ適用**:
- [ ] `:where(.ui-v2)` 配下で `--md-sys-color-primary` が解決する（`window.getComputedStyle`）
- [ ] `font-family` が Manrope/Inter 系
- [ ] Chart.js のグローバル defaults が v2 上書き（`Chart.defaults.font.family === 'Manrope, ...'`）

**退行チェック**:
- [ ] console error ゼロ
- [ ] pageerror ゼロ
- [ ] failed_requests ゼロ（`ac6bd5d` 以降 Vite HMR 済みなので許容無しで）

### 視覚差分（オプション）
- `responsive_1440x900_v2_real.png` / `print_v2_discovery_real.pdf` を新規取得
- Phase 5A の empty state 版と比較し、v2 報告書が実際に塗られていることを確認

### 実装方針
- [scripts/phase5a-verify.py](scripts/phase5a-verify.py) の構造を踏襲（`run_pattern` / `seed_auth` / `collect_listeners` 流用）
- 成果物は `verify_output/phase5b/` 配下（.gitignore 済）

---

## 5. Phase 5B-2: tokens.css @theme cleanup（0.1 日）

### 目的
PR #41 report §6 Medium #1 を消化する。

### 変更ファイル
- [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css)

### 方針
- `@theme { ... }` ブロック内の MD3 カスタムプロパティ定義を、同ファイル内の `:where(.ui-v2) { ... }` へ集約
- 既存の `:where(.ui-v2)` 配下の token 定義と**重複排除**（既に同名変数があれば `@theme` 側を削除）
- Tailwind v4 の `@theme` は `src/index.css` でのみ有効という原則を守る
- Vite build で `lightningcss` warning が消えることを確認

### 回帰チェック
- `npm run build` clean（warning なし）
- Vitest 153/153 緑（v2 テストで token 参照してるケースがある）
- Phase 5B-1 Pattern H で MD3 トークン解決が維持されとる

---

## 6. Phase 5B-3: Gate 判定 + リリース（0.1 日）

### Gate 条件
- [ ] Pattern G〜J 全て PASS（Critical/High 0）
- [ ] v2 5 コンポーネント全て DOM 存在確認済
- [ ] MD3 トークン / フォント / Chart.js defaults が v2 で解決
- [ ] `npm run build` warning なし（lightningcss `@theme` 警告消失）
- [ ] Vitest 153/153 緑
- [ ] `plans/2026-04-18-phase5b-verification-result.md` に数値結果記録
- [ ] codex-review (Diff + Release) 通過

### 成果物
- `scripts/phase5b-verify.py`
- `plans/2026-04-18-phase5b-verification-plan.md`（本ファイルの転記で可）
- `plans/2026-04-18-phase5b-verification-result.md`
- `src/components/report/v2/tokens.css`（dead @theme 削除）

### PR 作成
- ブランチ: `phase5b-real-data-e2e`
- squash merge、Vercel/Render デプロイ確認（Render 変更なしなら no-op）

---

## 7. Skills 活用マップ

| Phase | skill | 役割 |
|---|---|---|
| 5B-0 | — | 不二樹判断 |
| 5B-1 | webapp-testing | Playwright 実行環境 + dev server 管理 |
| 5B-1 | ui-design-review | v2 描画後の Botanical 準拠確認 |
| 5B-2 | codex-review (Plan) | @theme cleanup の設計レビュー |
| 5B-3 | codex-review (Diff) | PR 最終レビュー |
| 5B-3 | market-lens-release-check | リリース前チェック |
| 5B-3 | quick-git | PR 作成 / squash merge |

**並列化**: 本プランは工数が小さい（0.5〜1 日）ため単一エージェントで十分じゃ。agent-team-workflow は不要。

---

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| 実データの envelope が現仕様と不整合 | Pattern H で Network タブ確認、必要なら `brandEvalParser` MD fallback で救済（既実装） |
| v2 描画で予期せぬ Chart.js defaults 崩れ（v1 との混在） | `reportThemeV2.js` の `__reportThemeV2Snapshot` 復元機構が機能しとる前提、Pattern G→H→G の順序で検証 |
| 本番ジョブ実行コスト | まず既存 `a03bc0f98cfa` を試行、不足時のみ新規実行を不二樹に依頼 |
| `@theme` cleanup で Vitest 落ち | v2 コンポーネントの `getComputedStyle` 依存テストを事前に grep し影響範囲特定 |

---

## 9. 非ゴール（本プランで触らない）

- v2 デフォルト昇格（`useUiVersion` の DEFAULT 切替）→ Phase 5C で別 PR
- Phase 4B（EvidenceDetail / JudgmentBadge 等の v2 化）→ 別プラン
- MarketRangeV2 軸スケール統一、BrandRadarV2 同名 ID 衝突対策 → 低優先度、発覚時のみ
- backend の新規変更
- `ads-insights` 側への影響
- モバイル対応

---

## 10. 不二樹への確認事項（Phase 5B 開始前）

| # | 内容 | タイミング |
|---|---|---|
| 1 | 既存 `a03bc0f98cfa` で envelope が取得可能か（未達なら β/γ へ） | 5B-0 開始時 |
| 2 | 新規 Discovery ジョブ実行のコスト承認（α 不成立時） | 5B-0 進行中 |
| 3 | v2 デフォルト昇格（Phase 5C）への意思決定時期 | 5B Gate クリア後 |

---

## 11. Verification（End-to-End 検証手順）

```bash
# 1. 最新コード取得
git pull origin master  # a084d3c 以降

# 2. dev server + Playwright
# webapp-testing skill の with_server.py 経由で
python backends/../webapp-testing/scripts/with_server.py scripts/phase5b-verify.py

# 3. build / test
npm run build  # warning なし
npm test       # 153/153 緑
cd backends/market-lens-ai && python -m pytest tests/ -q  # 回帰確認

# 4. 本番稼働確認（no-op 想定）
curl https://insight-studio-chi.vercel.app/  # 200
curl https://market-lens-ai.onrender.com/api/ml/health  # 200
```

---

## 12. Critical Files（本プラン触る／参照する）

### 変更
- [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css) — @theme cleanup

### 新規
- `scripts/phase5b-verify.py`
- `plans/2026-04-18-phase5b-verification-result.md`

### 参照
- [scripts/phase5a-verify.py](scripts/phase5a-verify.py) — 構造流用元
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js)
- [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js)
- [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx)
- [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js)
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)
- [src/pages/Compare.jsx](src/pages/Compare.jsx)

---

**本プランは Phase 5A の自認した限界（empty state 限定）を埋めるための最小スコープじゃ。v2 デフォルト昇格の前提となる実データ根拠を獲得するのが目的で、それ以上は踏み込まぬ♡**
