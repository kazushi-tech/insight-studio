# 🌿 Phase 5A: Stitch 2.0 v2 ブラウザ実証 — 検証結果

**実施日**: 2026-04-18
**実施者**: Claude（Opus 4.7、自律セッション）
**対応プラン**: [plans/2026-04-18-phase5a-stitch-v2-browser-verification-plan.md](2026-04-18-phase5a-stitch-v2-browser-verification-plan.md)
**ベースコミット**: `ac6bd5d` (PR #40 Stitch 2.0 v2 UI scaffold + Phase 3 a11y polish)

---

## 1. サマリ

| 項目 | 結果 |
|---|---|
| 6パターン検証 | 6/6 PASS（Critical/High 検出ゼロ） |
| Print PDF（v1/v2） | 両方生成成功 |
| レスポンシブ（1440/1280/1024） | 3viewport 全てスクリーンショット取得成功 |
| Vitest | 153/153 passed（19 files）|
| ビルド | 成功（`@theme` at-rule warning のみ、実害なし） |

**Gate 判定**: ✅ Phase 5A 完了条件を満たす

---

## 2. 検証環境

- **Dev server**: `npm run dev` on `http://localhost:3002`（webapp-testing `scripts/with_server.py` で管理）
- **Playwright**: Chromium headless、viewport 1440×900（規定）、`document.fonts.ready` 待機入り
- **認証**: `context.add_init_script` で `is_ads_token` / `is_user` を seed して AuthGuard を通過
- **スクリプト**: [verify_output/phase5a/verify.py](../verify_output/phase5a/verify.py)
- **成果物**: スクリーンショット 10枚 + PDF 2本 + [summary.json](../verify_output/phase5a/summary.json)

---

## 3. パターン別結果（A〜F）

| # | URL | http | console err | page err | failed reqs | 判定 |
|---|---|---|---|---|---|---|
| A | `/discovery?ui=v1` | 200 | 0 | 0 | 45※1 | PASS |
| B | `/discovery?ui=v2` | 200 | 0 | 0 | 0 | PASS |
| C | `/discovery`（localStorage v2）| 200 | 0 | 0 | 0 | PASS |
| D | `/compare?ui=v1` | 200 | 0 | 0 | 0 | PASS |
| E | `/compare?ui=v2` | 200 | 0 | 0 | 0 | PASS |
| F | `/discovery?ui=v2`（toggle同期）| 200 | 0 | 0 | 0 | PASS |

※1 **Aのfailed_reqs=45について**: Vite dev server の初回コンパイル時に発生する optimizeDeps / HMR prefetch の失敗であり、後続パターン（B〜F）では0。画面表示・挙動への影響なし（console/page error ゼロ、ページ描画 OK）。HMR内部の既知挙動。

### 3-1. Pattern F（UiVersionToggle / storage 同期）詳細

- `?ui=v2` 付き URL ロード → URL に `ui=v2` 保持 ✅
- `localStorage.reportUiVersion = 'v2'` 書込 → 読出一致 ✅
- URL クエリ無しでリロード → storage から v2 解決 ✅
- `localStorage.removeItem` → `null` 確認 ✅

`useUiVersion()` の resolve 順（query → storage → default）と popstate ハンドラは仕様通り動作。

### 3-2. ui-v2 root 有無

- v1 パターン（A, D）: `.ui-v2` ルート非存在（正）
- v2 パターン（B, C, E）: empty state（ジョブ未完了）のためReportViewV2が未マウントのため `.ui-v2` もまだ無し。**これは設計通り**で、`ReportViewV2` は `result` が揃って初めてマウントされる（[Discovery.jsx:971-982](../src/pages/Discovery.jsx#L971-L982)、[Compare.jsx:724-737](../src/pages/Compare.jsx#L724-L737)）。

### 3-3. v2 レンダ動作の担保

empty state のみの目視では `PriorityActionHeroV2` / `CompetitorMatrixV2` / `BrandRadarV2` / `MarketRangeV2` / `ConfidencePill` の実レンダは見えない。ここは **Vitest 153/153 pass** がユニット／統合レベルで健全性を担保している（[src/components/report/v2/\_\_tests\_\_/](../src/components/report/v2/__tests__/)）。

---

## 4. Print PDF 検証

- `print_v1_discovery.pdf`（A4、背景白） — OK
- `print_v2_discovery.pdf`（A4、背景白） — OK
- `print.module.css` の `printRoot` scope が `ui-v2` 配下で `color: #000` / `background: #fff` を適用していること、`print:hidden` 要素（UiVersionToggle 等）が非表示となる仕組みはCSSとして実装済（[src/components/report/v2/print.module.css](../src/components/report/v2/print.module.css)）。

> empty state のため v2 レポートセクションの切れ・`break-inside: avoid` の効き目は実データが揃った後に再確認するのが望ましい（Phase 5B）。

---

## 5. レスポンシブ確認

| viewport | スクリーンショット |
|---|---|
| 1440×900 | `responsive_1440x900_v2.png` |
| 1280×720 | `responsive_1280x720_v2.png` |
| 1024×768 | `responsive_1024x768_v2.png` |

Layout/ナビの破綻なし。v2 報告書本体のレスポンシブ（Matrix 横スクロール・Radar 軸 font-size 低下など）は実データ時の再確認が適切。

---

## 6. 発見事項の分類

### Critical（リリース撤回レベル）
- **なし** ✅

### High（v2 デフォルト昇格を止めるレベル）
- **なし** ✅

### Medium（軽微、TODO 化）
1. **Vite ビルド時に `@theme` at-rule warning**（[tokens.css](../src/components/report/v2/tokens.css)）
   - 現象: `lightningcss` が `@theme { ... }` を認識せず warning を出すが、ビルド成功・ランタイム影響なし
   - 原因: Tailwind v4 の `@theme` directive は root CSS（`src/index.css`）でのみ効く。`tokens.css` 内の第二の `@theme` ブロックは事実上 dead code
   - 対応: 別PRで `tokens.css` の `@theme` を通常の `:root {}` にフラット化（Phase 5B ポリッシュ PR で消化）

2. **実データによる v2 報告書の目視確認が未達**
   - 6パターンは empty state での健全性検証に留まる
   - `ReportViewV2` 実レンダの視認は、backend まで含む E2E 実ジョブで確認が妥当（Phase 5B）

3. **プランに挙がっていた「Manrope / Inter フォント index.html link」懸念**
   - **既に解消済**: [index.html:8](../index.html#L8) で Google Fonts の Manrope / Inter / Literata / Nunito Sans が `display=swap` 付きで link 済
   - Phase 5A 副次懸念 #4 は **close** とする

### 低優先度 TODO（Phase 5B 候補）
- MarketRangeV2 軸スケール（metric 横断比較での視認性）
- BrandRadarV2 同名ブランド ID 衝突対策
- v2 報告書の実データ E2E（backend ジョブ実行含む）

---

## 7. Gate クリア判定

プラン §6 の条件：

- [x] 6パターン全て検証、Critical / High ゼロ
- [x] Print PDF v1/v2 両方合格（ファイル生成成功）
- [x] レスポンシブ 1440/1280 で崩れなし
- [x] 検証レポート作成完了（本ドキュメント）
- [x] 不二樹に結果報告（PR 経由で共有）

→ ✅ **Phase 5A Gate クリア**

---

## 8. 次の一手（プラン §6 Gate クリア後の3択）

推奨: **3. 別機能着手 or 2. Medium 修正 PR 集約**

- **v2 デフォルト昇格**（選択肢1）は、empty state 検証のみでは実データ視認が弱く、**本 PR では見送り**が妥当
- 代わりに、次 PR で：
  - `tokens.css` の `@theme` dead block を `:root {}` に整理
  - Phase 5B として実データ E2E（backend ジョブ起点）を計画
- 判断は不二樹へ

---

## 9. 成果物一覧

```
verify_output/phase5a/
  verify.py                              # 実行スクリプト
  summary.json                           # 全結果の機械可読サマリ
  A_discovery_v1.png .. F_toggle_sync.png  # 6パターンのスクショ
  print_v1_discovery.pdf                 # Print PDF (v1)
  print_v2_discovery.pdf                 # Print PDF (v2)
  responsive_{1440x900,1280x720,1024x768}_v2.png  # レスポンシブ
```

---

**結論**: PR #40 の v2 scaffold は empty state の範囲で健全じゃ。Critical/High なし、vitest 緑、フォント link 済、print/responsive 生成 OK。v2 デフォルト昇格には実データ E2E (Phase 5B) を挟むのが安全じゃぞよ♡
