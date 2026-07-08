# LP Full Redesign Plan

## Context

**問題:** `/lp` 以下の全6ページ + 4共通コンポーネントが「ダサい」状態。
- 18+枚の外部画像が全て壊れている（Google AIDA public URLの期限切れ）
- 3つの異なるカラーシステムが混在（Terra `#4a7c59` / Luminous Architect `#006c49` / Tailwind `emerald-*`）
- ナビバーの色ズレ、CTAの色不統一、ページ間のデザイン言語バラバラ

**目標:** Stitch 2.0参照デザイン（`stitch2_LP/` の screen.png）に準拠した、統一感のあるモダンSaaS LPに刷新する。

**参照デザイン特徴（Stitch screen.png から確認済み）:**
- 白背景 + ダークグリーン（`#0f5238`系）のヒーロー/差別化セクション
- カード: ボーダーなし、トーナルレイヤリング、ホバーで微妙なシャドウ
- ダッシュボード風モックアップ（ブラウザクロム付き）
- ゴールドアクセント控えめ、グリーン主体
- クリーンなタイポグラフィ（Manrope）

---

## 方針決定

### カラーシステム: landing.css の Luminous Architect パレットに統一

| Role | Token | Hex |
|------|-------|-----|
| Primary | `--color-primary` | `#006c49` |
| Primary Container | `--color-primary-container` | `#10b981` |
| Tertiary (Gold) | `--color-tertiary` | `#795900` |
| Background | `--color-background` | `#ffffff` |
| Surface Container Low | `--color-surface-container-low` | `#f3f4f6` |
| On Surface | `--color-on-surface` | `#0b1c30` |
| On Surface Variant | `--color-on-surface-variant` | `#3c4a42` |

**排除対象（全てトークンに置換）:**
- `#4a7c59` → `bg-primary` / `text-primary`
- `#faf6f0` → `bg-white` / `bg-surface-container-low`
- `#c8e8d0` → `bg-primary-fixed/20`
- `#2e3230` → `text-on-surface`
- `#4a4e4a` → `text-on-surface-variant`
- `#e4e0d8` → `border-outline-variant/30`
- `#705c30` → `text-tertiary`
- `#f5f1ea` → `bg-surface-container-low`
- `#d8f0de` → `text-primary-fixed`
- `#c4a66a` → `text-tertiary-fixed-dim`
- `emerald-*` → 対応するデザイントークン
- `stone-*` → 対応するデザイントークン

### 画像戦略: CSS/SVGモックアップ + ローカルアセット

壊れた外部画像18枚を全てCSS製ダッシュボードモックアップコンポーネントに置換。
新規ファイル `src/pages/landing/components/LpMockups.jsx` を作成。

---

## Agent Team 構成（4並列ワークストリーム）

### Agent 1: Foundation（基盤コンポーネント）
**ファイル:** 新規 `LpMockups.jsx` + `LpNavbar.jsx` + `LpFooter.jsx` + `LpCta.jsx` + `landing.css`

#### Task 1-1: `LpMockups.jsx` 新規作成
CSS/Tailwindのみで構築するモックアップコンポーネント群:
- `DashboardMockup` — ブラウザクロム風フレーム + メトリクスカード + バーチャート + AI考察バブル
- `ComparisonMockup` — 2つのLP画面を並べた比較ビュー
- `RadarChartMockup` — CSS描画のレーダーチャート（4-5軸）
- `NetworkMapMockup` — 円と線で競合マップを表現
- `BeforeAfterMockup` — Before（雑然）/ After（洗練）の2カード
- `ChartMockup` — CSSバー/ラインチャート

各モックアップはStitch参照デザインのダッシュボード風外観を再現すること。
ダークグリーン背景 + 白テキスト + グリーンアクセントのカラースキーム。

#### Task 1-2: `LpNavbar.jsx` 修正
- `bg-[#faf6f0]` → `bg-white/90 backdrop-blur-lg`（ガラスモーフィズム）
- スクロール時のシャドウはそのまま維持
- モバイルハンバーガーメニュー追加（現在hidden md:flexでモバイル対応なし）
- CTAボタンのスタイル微調整

#### Task 1-3: `LpFooter.jsx` 修正
- `bg-stone-100` → `bg-surface-container-low`
- 全 `text-stone-*` → `text-on-surface` / `text-on-surface-variant`
- 全 `#4a7c59` → `text-primary`
- `font-['Nunito_Sans']` → `font-body`（Manrope）
- `hover:text-[#4a7c59]` → `hover:text-primary`

#### Task 1-4: `LpCta.jsx` 修正
- 全 `emerald-*` Tailwindユーティリティ → デザイントークン
  - `from-emerald-900 to-emerald-700` → `from-[#003d2a] to-primary`
  - `bg-emerald-400 text-emerald-950` → `bg-primary-fixed text-on-primary-fixed`
  - `bg-emerald-600 text-white` → `bg-primary text-on-primary`
  - `bg-emerald-50/50` → `bg-primary-fixed/10`
  - `border-emerald-*` → `border-primary/20`
  - `text-emerald-*` → `text-primary` / `text-primary-fixed`
- `bg-amber-500/5` → `bg-tertiary/5`

---

### Agent 2: Main Pages（メインページ2枚）
**ファイル:** `LandingPage.jsx` + `LpPricing.jsx`

#### Task 2-1: `LandingPage.jsx` 全面修正（最重要ページ）
**カラー置換（18箇所）:**
- Hero: `#4a7c59`×6, `#c8e8d0`, `#2e3230`, `#4a4e4a`, `#705c30` → 全てトークン化
- Problem: `#e4e0d8/60` border → `border-outline-variant/30`
- Bento: `bg-[#f5f1ea]` → `bg-surface-container-low`
- Differentiation: `#0f5238`はLP用ダーク→ `bg-[#003d2a]`に統一, `#c4a66a` → `text-tertiary-fixed-dim`

**画像置換（3箇所）:**
- Hero ダッシュボード画像 → `<DashboardMockup />`
- Bento「競合LP比較」カード画像 → `<DashboardMockup variant="compact" />`
- 差別化セクション画像 → `<ComparisonMockup />` または装飾的CSSイラスト

**デザイン改善:**
- Bentoグリッドのテキストのみカードにアイコンバッジ追加
- セクションヘッダーパターン統一（label + h2）

#### Task 2-2: `LpPricing.jsx` カラー統一
**カラー置換（18箇所）:**
- Hero: 同パターンで全hex → トークン
- 料金カード: `bg-[#4a7c59]` → `bg-primary`, `bg-[#0f5238]` → `bg-[#003d2a]`
- `#c4a66a` バッジ → `bg-tertiary-fixed-dim`
- FAQ: `bg-[#f5f1ea]` → `bg-surface-container-low`
- 全テキストカラー → トークン

---

### Agent 3: Feature Pages（機能紹介3ページ）
**ファイル:** `LpCompare.jsx` + `LpPerformance.jsx` + `LpCreative.jsx`

#### Task 3-1: `LpCompare.jsx`
- 壊れた画像2枚 → `<ComparisonMockup />` + `<DashboardMockup />`
- カラースウォッチ部分（`#4a7c59`等）はデモ表示なのでそのまま維持
- `stone-*` ユーティリティがあれば → トークン

#### Task 3-2: `LpPerformance.jsx`
- 壊れた画像1枚 → `<ChartMockup />`
- `bg-[#faf6f0]` → `bg-surface-container-low`
- `text-stone-*` → `text-on-surface-variant`

#### Task 3-3: `LpCreative.jsx`（画像最多）
- 壊れた画像5枚:
  - Hero → `<DashboardMockup variant="creative" />`
  - レーダーチャート → `<RadarChartMockup />`
  - AI分析ステップ → アイコン+テキストのカード（画像不要に）
  - Before/After → `<BeforeAfterMockup />`
- カラーは既にトークン使用済み → 最小限の修正

---

### Agent 4: Discovery Page（最大工事）
**ファイル:** `LpDiscovery.jsx`

#### Task 4-1: Hero セクション再設計
- 現在: フルスクリーングラデーション `from-[#064e3b] via-[#10b981] to-[#D4A843]`
- 変更: 白背景 + グリーンアクセントの他ページ統一スタイルに
- フローティングアニメーション要素 → 削除
- `min-h-screen` → `pt-32 pb-24`（他ページと統一）

#### Task 4-2: カラー統一（10+ emerald置換）
- `emerald-400/500/600/700/900/950` → 全てデザイントークン
- `amber-300/400/500` → `tertiary` 系トークン
- `bg-[#0b1c30]` ダークセクション → `bg-[#003d2a]`

#### Task 4-3: 画像置換（2枚）
- 競合マップ → `<NetworkMapMockup />`
- ネットワークマップ → `<NetworkMapMockup variant="detail" />`

#### Task 4-4: 構造整理
- アンビエントオーブ（`lp-orb`）削除
- インラインCTAセクション → `<LpCta variant="dark" />` に置換
- 全セクションを `<LpSection>` でラップ（現在一部raw `<section>`）

---

## 実行順序

```
Phase 1 (並列起動):
  Agent 1 → LpMockups.jsx 作成 + LpNavbar/Footer/Cta 修正
  Agent 2 → LandingPage.jsx + LpPricing.jsx カラー置換（画像以外先行可能）
  Agent 3 → LpCompare/Performance/Creative カラー置換（画像以外先行可能）  
  Agent 4 → LpDiscovery.jsx 構造リファクタ + カラー置換

Phase 2 (Agent 1完了後):
  Agent 2/3/4 → LpMockups.jsx からimportして画像部分を差し替え
  ※ Agent 1の LpMockups.jsx が完成次第、他agentが参照可能

Phase 3 (全Agent完了後):
  検証 → ビルド確認 → 目視チェック
```

## 検証チェックリスト

実装完了後に以下を確認:

1. **カラー残留チェック** — `src/pages/landing/` 内で以下がゼロであること:
   - `#4a7c59`, `#faf6f0`, `#c8e8d0`, `#705c30`, `#2e3230`, `#4a4e4a`
   - `#e4e0d8`, `#f5f1ea`, `#d8f0de`, `#c4a66a`
   - `emerald-` Tailwindユーティリティ
   - `stone-` Tailwindユーティリティ
   - `lh3.googleusercontent.com` 画像URL

2. **ビルド確認** — `npm run build` が成功すること

3. **全6ルート目視確認:**
   - `/lp` — Hero画像表示、Bentoグリッド、色統一
   - `/lp/pricing` — 料金カード3枚、FAQアコーディオン
   - `/lp/compare` — 比較モックアップ表示
   - `/lp/performance` — チャートモックアップ表示
   - `/lp/creative` — レーダーチャート、Before/After表示
   - `/lp/discovery` — 新Heroデザイン、ネットワークマップ

4. **レスポンシブ確認** — モバイル幅でナビバーのハンバーガーメニュー動作

## 対象ファイル一覧

| ファイル | 操作 |
|---------|------|
| `src/pages/landing/components/LpMockups.jsx` | **新規作成** |
| `src/pages/landing/components/LpNavbar.jsx` | 修正 |
| `src/pages/landing/components/LpFooter.jsx` | 修正 |
| `src/pages/landing/components/LpCta.jsx` | 修正 |
| `src/pages/landing/LandingPage.jsx` | 大幅修正 |
| `src/pages/landing/LpPricing.jsx` | 大幅修正 |
| `src/pages/landing/LpCompare.jsx` | 修正 |
| `src/pages/landing/LpPerformance.jsx` | 修正 |
| `src/pages/landing/LpCreative.jsx` | 修正 |
| `src/pages/landing/LpDiscovery.jsx` | **大幅リライト** |
| `src/styles/landing.css` | 微修正（必要に応じて） |

## Agent Team 実行コマンド

`/agent-team-workflow` で以下4エージェントを並列実行:
- **Agent 1 (Foundation):** Task 1-1〜1-4
- **Agent 2 (Main Pages):** Task 2-1〜2-2
- **Agent 3 (Feature Pages):** Task 3-1〜3-3
- **Agent 4 (Discovery):** Task 4-1〜4-4
