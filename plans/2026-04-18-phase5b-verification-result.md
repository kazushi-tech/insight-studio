# Phase 5B: 実データ E2E による Stitch 2.0 v2 検証 — 実行結果

**実行日**: 2026-04-18
**実行者**: Claude (Opus 4.7, Auto mode)
**対応プラン**: [plans/claude-html-markdown-claude-claude-jolly-kay.md](claude-html-markdown-claude-claude-jolly-kay.md)
**ベースコミット**: `583902c`（master）

---

## 1. Summary

| 項目 | 結果 |
|---|---|
| `@theme` dead block cleanup（lightningcss warning 解消） | ✅ 完了 |
| `scripts/phase5b-verify.py` 新設 | ✅ 完了 |
| `npm run build` warning-free | ✅ |
| Vitest 153/153 | ✅ 緑 |
| backend `pytest` | ⚠️ 既存ハング（Phase 5B 無関係、pre-existing） |
| 実データ E2E 実行（Pattern G〜J） | ⏸ 環境要件未整備のため保留 |

Gate: **partial pass** — 静的成果物は全て揃い、Vitest・build は緑。実データ Playwright 検証は `DISCOVERY_SEARCH_ID` と稼働中の backend/dev server が必要なため、不二樹環境での実行を推奨。

---

## 2. プラン前提との差分

プランは Phase 5A（PR #41）が完了済として書かれておるが、実リポジトリに以下の差異があったため、実装方針を調整した。

| プラン記述 | 実態 | 対応 |
|---|---|---|
| ベースコミット `a084d3c` (PR #41) | `git log` 上は `583902c`（PR #40 = `ac6bd5d`）が最新 | master HEAD をベースに実施 |
| `scripts/phase5a-verify.py` を構造流用 | 存在せず | `webapp-testing` skill の example を参照して自前実装 |
| `src/components/report/v2/tokens.css` の `@theme` dead block を整理 | `tokens.css` に `@theme` は無し。lightningcss warning の実際の発生元は `src/styles/landing.css` | プラン意図（warning 解消）に沿って `landing.css` を修正 |

---

## 3. 変更内容

### 3-1. `src/styles/landing.css` — dead `@theme` 削除

Tailwind v4 の `@theme` は `src/index.css`（`@import "tailwindcss"` を含む entry）でしか処理されぬ。`landing.css` にあった `@theme { ... }` は lightningcss まで残り `Unknown at rule: @theme` warning を出す dead block であった。

削除した変数：

- `--font-headline` / `--font-body` / `--font-label` — `var(--font-*)` 参照は無し。`.font-headline` 等の Tailwind 風 class も実体は生成されておらぬため、削除して OK。`.lp-page` 内の `font-family: "Manrope"` 直指定がフォント適用を担っとる。
- `--color-on-tertiary-container` / `--color-on-tertiary-fixed` / ...（計 7 件）— いずれも `.lp-page` scope で同値定義済。重複排除。

### 3-2. `scripts/phase5b-verify.py` — 新設

Phase 5A の empty state 限定検証の限界を埋めるための再現可能 harness。Playwright sync API で以下 4 パターンを走らせる：

| # | パターン名 | URL | 目的 |
|---|---|---|---|
| G | `G_discovery_v1` | `/discovery/result?search_id=<id>&ui=v1` | v1 baseline 回帰確認 |
| H | `H_discovery_v2` | `/discovery/result?search_id=<id>&ui=v2` | **v2 実描画メイン検証** |
| I | `I_compare_v2` | `/compare/result?search_id=<id>&ui=v2` | Compare 側 v2 |
| J | `J_discovery_v2_md_fallback` | 同 H + `report-envelope` を 404 で固定 | MD fallback 動作確認 |

v2 共通チェック：

- `div.ui-v2` ルートの存在
- `PriorityActionHeroV2` / `CompetitorMatrixV2` / `BrandRadarV2` / `MarketRangeV2` / `ConfidencePill` の DOM 出現
- `--md-sys-color-primary` が `.ui-v2` で resolve すること（`#003925` or `rgb(0, 57, 37)`）
- `font-family` が `Manrope` / `Inter` を含む
- `Chart.defaults.font.family` に `Manrope`
- console error / pageerror / failed request ゼロ

出力先: `verify_output/phase5b/*.png` + `summary.json`（`.gitignore` 済）。

実行例：

```bash
export DISCOVERY_SEARCH_ID=a03bc0f98cfa   # 実データジョブ ID
export AUTH_TOKEN=...                     # 必要なら localStorage 注入
# dev.ps1 等で dev server + 両 backend を起動してから
python scripts/phase5b-verify.py
```

### 3-3. `.gitignore` — `verify_output/` 追加

Playwright 成果物（PNG, summary.json, PDF）がコミットされぬよう保護。

---

## 4. 実行ログ

### 4-1. Static checks（全緑）

```
$ npm run build
vite v8.0.2 building client environment for production...
✓ 368 modules transformed.
dist/assets/index-BjmkZQp7.css    172.79 kB │ gzip:  26.81 kB
dist/assets/index-BCkfLEmW.js   1,419.71 kB │ gzip: 430.78 kB
✓ built in 871ms
```

**→ `lightningcss minify` の `Unknown at rule: @theme` warning が消えた。CSS size は 173.31 → 172.79 kB へ微減。**

```
$ npm test
 Test Files  19 passed (19)
      Tests  153 passed (153)
```

### 4-2. Backend pytest（保留）

```
$ cd backends/market-lens-ai && python -m pytest tests/ -q
（60 秒以上 output なしでハング。--collect-only でも同様）
```

`tests/conftest.py` が `web.app.main` を import する時点でハングしとる可能性（LLM client 初期化等）。本 Phase 5B は `backends/` 無変更ゆえ、このハングは Phase 5B の責務外の既存問題と判断し、master HEAD でも同様に再現するはずじゃ。

### 4-3. Playwright 実データ E2E（保留）

`DISCOVERY_SEARCH_ID` 未設定の状態で script を起動した結果：

```
$ python scripts/phase5b-verify.py
[phase5b] DISCOVERY_SEARCH_ID env var is required — skipping run.
  Export it to a completed Discovery job id, e.g.:
  DISCOVERY_SEARCH_ID=a03bc0f98cfa python scripts/phase5b-verify.py
```

script の import / CLI は問題なく動作。実行には以下が必要：

1. 完了済 Discovery ジョブの `search_id`（プラン案 α: 既存 `a03bc0f98cfa` など）
2. `./dev.ps1` 等で dev server（3002）+ market-lens-ai（8002）+ ads-insights（8001）を起動
3. 必要なら `AUTH_TOKEN` を env に注入

---

## 5. Gate 判定

| 条件 | 結果 |
|---|---|
| `npm run build` warning なし | ✅ |
| Vitest 153/153 緑 | ✅ |
| Pattern G〜J PASS（Critical/High 0） | ⏸ 保留 |
| v2 5 コンポーネント DOM 存在 | ⏸ 保留（Pattern H/I で確認予定） |
| MD3 トークン / フォント / Chart.js defaults | ⏸ 保留 |
| result.md 作成 | ✅ |
| codex-review（Diff + Release） | 不二樹判断 |

**結論**: 静的検証は全緑、harness は整備済。実データ E2E は不二樹環境での一度の実行で `summary.json` が得られる状態となった。v2 デフォルト昇格（Phase 5C）は、この実データ検証 PASS 後を推奨。

---

## 6. 次アクション（Phase 5C 以降）

1. 不二樹環境で `python scripts/phase5b-verify.py` を実行し `verify_output/phase5b/summary.json` を取得
2. summary の `all_passed: true` を確認できたら Phase 5C（`useUiVersion.DEFAULT = 'v2'`）を着手
3. backend pytest のハングは別チケットで根本調査（Phase 5B 外）

---

**Phase 5B 成果物**: `src/styles/landing.css`, `scripts/phase5b-verify.py`, `.gitignore`, 本 result.md。
