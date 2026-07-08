# LP Full Redesign Plan — レビュー済み改善版

## Context

**問題:** `/lp` 以下の全6ページ + 4共通コンポーネントのデザイン不統一。
- 13枚の外部画像（Google Aida public URL）が存在 — 壊れているかは要確認
- 3つの異なるカラーシステムが混在（Terra `#4a7c59` / Luminous Architect `#006c49` / Tailwind `emerald-*` / `stone-*`）
- ナビバーの色ズレ、CTAの色不統一、ページ間のデザイン言語バラバラ

**目標:** `landing.css` に定義済みの Luminous Architect デザイントークンに全カラーを統一し、モダンSaaS LPに刷新する。

---

## 元プラン（peppy-twirling-fairy.md）のレビュー結果

### Critical Issues

| # | 問題 | 重要度 | 対応 |
|---|------|--------|------|
| 1 | **参照デザインの矛盾** — `stitch2_LP/` の DESIGN.md は "Terra" パレット（`#4a7c59`）を定義しているが、プランでは「Stitch参照に準拠」と言いつつ Terra カラーを排除対象にしている | Critical | `landing.css` のトークンを唯一の正とする。Stitch参照はレイアウト参考のみ |
| 2 | **画像の状態未確認** — 「18+枚が全て壊れている」と断定しているが、実際は13枚で壊れているかは未検証。LpMockups.jsx（6コンポーネント、推定300-500行）の作成が不要な可能性あり | Critical | Phase 0 で画像表示を `/devtools-verify` で確認。壊れている場合のみモックアップ作成 |

### Major Issues

| # | 問題 | 重要度 | 対応 |
|---|------|--------|------|
| 3 | **Agent間の依存ボトルネック** — 4 Agent構成でAgent 1（LpMockups.jsx）完了まで他3Agentが画像差し替え不可 | Major | Agent構成を3並列に再編。モックアップは条件付きPhase 2へ |
| 4 | **カラー置換数の過小評価** — プランは「18箇所」等と記載しているが、実際は全体で~135置換（hex 86 + emerald 26 + stone 23） | Major | 正確なファイル別カウントを記載 |
| 5 | **スコープクリープ** — LpNavbar にモバイルハンバーガーメニュー追加を含んでいるが、CLAUDE.md に「PC専用」と明記されている | Major | モバイルメニュー追加を削除 |
| 6 | **LpCreative.jsx 不要な変更** — プランでは画像5枚の置換を指示しているが、カラーは既に全てトークン化済み（旧hex 0件） | Major | LpCreative.jsx はカラー修正対象から除外。画像のみ条件付き対応 |
| 7 | **LpCompare.jsx の誤った修正指示** — `#4a7c59` 等 4件はカラースウォッチのデモ表示（L202-205）であり意図的 | Major | LpCompare.jsx のhex値はデモ用として維持 |

### Minor Issues

| # | 問題 | 重要度 | 対応 |
|---|------|--------|------|
| 8 | **Skills未活用** — `/agent-team-workflow` のみ言及。品質ゲートや検証Skillsが未統合 | Minor | `/devtools-verify`, `/project-health`, `/codex-review`, `/ui-design-review` を各フェーズに統合 |
| 9 | **トークン互換性** — Tailwind v4 の `@theme` ブロックでトークンが定義済みか未確認 | Minor | 確認済み：`index.css` の `@theme` + `landing.css` の `.lp-page` スコープで正常動作 |

---

## 改善プラン

### カラーシステム: `landing.css` の Luminous Architect パレットに統一

| Role | Token | Hex |
|------|-------|-----|
| Primary | `--color-primary` | `#006c49` |
| Primary Container | `--color-primary-container` | `#10b981` |
| Primary Fixed | `--color-primary-fixed` | `#6ffbbe` |
| Tertiary (Gold) | `--color-tertiary` | `#795900` |
| Tertiary Fixed Dim | `--color-tertiary-fixed-dim` | `#c79c38` |
| Background | `--color-background` | `#ffffff` |
| Surface Container Low | `--color-surface-container-low` | `#f3f4f6` |
| On Surface | `--color-on-surface` | `#0b1c30` |
| On Surface Variant | `--color-on-surface-variant` | `#3c4a42` |
| Outline Variant | `--color-outline-variant` | `#bfc9c1` |

**排除対象カラー → トークンマッピング:**

| 旧カラー | 件数 | → 新トークン |
|---------|------|-------------|
| `#4a7c59` | 32件 | `bg-primary` / `text-primary` |
| `#2e3230` | 11件 | `text-on-surface` |
| `#4a4e4a` | 10件 | `text-on-surface-variant` |
| `#c8e8d0` | 6件 | `bg-primary-fixed/20` |
| `#d8f0de` | 6件 | `text-primary-fixed` |
| `#c4a66a` | 5件 | `text-tertiary-fixed-dim` |
| `#e4e0d8` | 4件 | `border-outline-variant/30` |
| `#f5f1ea` | 4件 | `bg-surface-container-low` |
| `#faf6f0` | 3件 | `bg-white` / `bg-surface-container-low` |
| `#705c30` | 3件 | `text-tertiary` |
| `#0f5238` | 2件 | `bg-[#003d2a]`（LP専用ダーク） |
| `emerald-*` | ~26件 | 対応トークン |
| `stone-*` | ~23件 | 対応トークン |
| **合計** | **~135件** | |

---

### 実行フェーズ

#### Phase 0: 事前確認（単独作業）
1. `lp-redesign` ブランチを作成
2. `npm run dev` で開発サーバー起動
3. `/devtools-verify` で `/lp` の全6ページを確認
   - **画像が表示されるか？** → 壊れていればPhase 2でモックアップ作成
   - 現状のデザイン状態をスクリーンショット記録
4. 確認結果に基づきPhase 2の要否を決定

#### Phase 1: カラー統一（3 Agent並列 — `/agent-team-workflow`）

**Agent A: Heavy Pages** — LandingPage.jsx + LpPricing.jsx
| ファイル | 置換数 | 主な作業 |
|---------|--------|---------|
| `src/pages/landing/LandingPage.jsx` | ~35件 | 全hex→トークン化。Hero/Problem/Bento/Differentiationセクション |
| `src/pages/landing/LpPricing.jsx` | ~25件 | 全hex→トークン化。料金カード/FAQ/Hero |

**Agent B: Components + Light Pages** — LpNavbar + LpFooter + LpCta + LpPerformance
| ファイル | 置換数 | 主な作業 |
|---------|--------|---------|
| `src/pages/landing/components/LpNavbar.jsx` | ~5件 | `#faf6f0`→`bg-white/90 backdrop-blur-lg`, `stone-*`→トークン |
| `src/pages/landing/components/LpFooter.jsx` | ~21件 | `stone-*`→トークン, `#4a7c59`→`text-primary`, `Nunito Sans`→`font-body` |
| `src/pages/landing/components/LpCta.jsx` | ~26件 | `emerald-*`全置換→デザイントークン |
| `src/pages/landing/LpPerformance.jsx` | ~8件 | `#faf6f0`/`stone-*`→トークン |

**Agent C: Discovery Overhaul** — LpDiscovery.jsx
| ファイル | 置換数 | 主な作業 |
|---------|--------|---------|
| `src/pages/landing/LpDiscovery.jsx` | ~40件 | Hero再設計（白背景+グリーンアクセント統一）、`emerald-*`/`amber-*`全置換、`lp-orb`削除、構造整理 |

**対象外（変更不要）:**
- `LpCreative.jsx` — カラーは既にトークン化済み（旧hex 0件）
- `LpCompare.jsx` — hex 4件はカラースウォッチデモ表示用（意図的）
- `LpSection.jsx` — 変更不要
- `landing.css` — トークン定義は現状で正しい

#### Phase 1.5: 品質ゲート
1. `/project-health` — ビルド・型チェック
2. `/codex-review` — Phase 1の差分をレビュー
3. 問題があれば修正→再ビルド確認

#### Phase 2: 画像対応（条件付き — Phase 0の結果次第）

**画像が壊れている場合のみ実行:**
1. `src/pages/landing/components/LpMockups.jsx` を新規作成
   - CSS/Tailwindのみで構築するモックアップコンポーネント群
   - `DashboardMockup`, `ComparisonMockup`, `RadarChartMockup`, `NetworkMapMockup`, `BeforeAfterMockup`, `ChartMockup`
2. 各ページの `<img>` タグをモックアップコンポーネントに差し替え

| ファイル | 画像数 | 置換先 |
|---------|--------|--------|
| LpCreative.jsx | 6枚 | DashboardMockup, RadarChartMockup, BeforeAfterMockup等 |
| LandingPage.jsx | 3枚 | DashboardMockup, ComparisonMockup |
| LpDiscovery.jsx | 2枚 | NetworkMapMockup |
| LpCompare.jsx | 2枚 | ComparisonMockup, DashboardMockup |
| LpPerformance.jsx | 1枚 | ChartMockup |

**画像が正常な場合:** Phase 2をスキップ

#### Phase 3: 最終検証
1. **カラー残留チェック** — `src/pages/landing/` 内で以下がゼロであること:
   ```
   grep -cE '#4a7c59|#faf6f0|#c8e8d0|#705c30|#2e3230|#4a4e4a|#e4e0d8|#f5f1ea|#d8f0de|#c4a66a|emerald-|stone-' src/pages/landing/
   ```
   ※ LpCompare.jsx L202-205のデモ用スウォッチは例外として許容
2. `/project-health` — ビルド成功確認
3. `/devtools-verify` — 全6ルートを目視確認:
   - `/lp` — Hero、Bentoグリッド、色統一
   - `/lp/pricing` — 料金カード3枚、FAQアコーディオン
   - `/lp/compare` — 比較モックアップ表示
   - `/lp/performance` — チャートモックアップ表示
   - `/lp/creative` — レーダーチャート、Before/After表示
   - `/lp/discovery` — 新Heroデザイン、ネットワークマップ
4. `/ui-design-review` — デザイン品質・一貫性チェック
5. `/simplify` — 変更ファイルのコード品質チェック

---

### 対象ファイル一覧

| ファイル | 操作 | Agent |
|---------|------|-------|
| `src/pages/landing/LandingPage.jsx` | 大幅修正 | A |
| `src/pages/landing/LpPricing.jsx` | 大幅修正 | A |
| `src/pages/landing/components/LpNavbar.jsx` | 修正 | B |
| `src/pages/landing/components/LpFooter.jsx` | 修正 | B |
| `src/pages/landing/components/LpCta.jsx` | 修正 | B |
| `src/pages/landing/LpPerformance.jsx` | 修正 | B |
| `src/pages/landing/LpDiscovery.jsx` | 大幅リライト | C |
| `src/pages/landing/components/LpMockups.jsx` | **新規作成（条件付き）** | Phase 2 |

**変更不要:**
| ファイル | 理由 |
|---------|------|
| `src/pages/landing/LpCreative.jsx` | カラー既にトークン化済み |
| `src/pages/landing/LpCompare.jsx` | hex 4件はデモ用スウォッチ |
| `src/pages/landing/components/LpSection.jsx` | 変更不要 |
| `src/pages/landing/LpLayout.jsx` | 変更不要 |
| `src/styles/landing.css` | トークン定義は現状で正しい |

---

### Skills 統合マップ

| Phase | Skill | 用途 |
|-------|-------|------|
| Phase 0 | `/devtools-verify` | 画像の生存確認 + 現状スクリーンショット |
| Phase 1 | `/agent-team-workflow` | 3 Agent 並列実行 |
| Phase 1.5 | `/project-health` | ビルド確認 |
| Phase 1.5 | `/codex-review` | 差分品質レビュー |
| Phase 3 | `/devtools-verify` | 全6ルート目視確認 |
| Phase 3 | `/ui-design-review` | デザイン品質チェック |
| Phase 3 | `/simplify` | コード品質チェック |

### リスク軽減策

1. **ブランチ戦略:** `lp-redesign` ブランチで作業。各Phaseの完了時にコミット
2. **画像は事前確認:** LpMockups.jsx（300-500行の大作業）を不要に作成するリスクを回避
3. **インクリメンタルコミット:** Agent毎にコミット → restore pointを確保
4. **スコープ厳守:** カラー統一のみ。新機能追加（モバイルメニュー等）は別タスク
