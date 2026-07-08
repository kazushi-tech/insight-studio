# Insight Studio LP サイト実装計画

## Context

Insight Studio の営業・マーケティング用ランディングページ群を、Google Stitch 2 で作成したデザインをベースに実装する。Stitch 2 のエクスポート（HTML + Tailwind CSS）を React コンポーネントに変換し、既存アプリに統合する。

**目的:** Insight Studio の価値を伝え、新規ユーザー獲得につなげる公開ページ群の構築

## Stitch 2 エクスポート → ページ対応表

| フォルダ | ページ | ヒーローコピー | 行数 |
|----------|--------|---------------|------|
| stitch (9) | 競合LP比較 | 「競合LPを、AIが丸裸にする。」 | 370 |
| stitch (10) | 競合ディスカバリー | 「まだ気づいていない競合、見逃していませんか？」 | 350 |
| stitch (11) | 広告パフォーマンス考察 | 「数字の裏にある"なぜ？"を、AIが読み解く。」 | 373 |
| stitch (12) | クリエイティブ診断 | 「そのクリエイティブ、本当に刺さっていますか？」 | 324 |
| stitch (13) | 料金プラン | 「あなたのチームに最適なプランを。」 | 327 |
| stitch (14) | メインLP | 「広告運用の"なぜ？"を、AIが解き明かす。」 | ~350 |

## デザインシステムの方針

Stitch 2 の Terra テーマと既存アプリのデザイントークンは異なる。**LP は Stitch デザインをそのまま採用する。**

| 要素 | アプリ (既存) | LP (Stitch Terra) |
|------|-------------|-------------------|
| Primary | #0f5238 | #4a7c59 |
| Background | #f8f8f5 | #faf6f0 |
| Accent | — | #705c30 (warm amber) |
| 見出しフォント | Manrope | Literata (serif) |
| 本文フォント | Inter | Nunito Sans |
| 角丸 | 0.75rem | 0.75rem (12px) |

**理由:** LPはマーケティングページ。アプリとは異なるトーン（温かみ・親しみやすさ）が適切。ユーザーがログイン後にアプリのデザインに切り替わるのは自然な遷移。

## ファイル構成

```
src/
  pages/
    landing/
      LandingPage.jsx        ← メインLP (オーケストレーター)
      LpCompare.jsx          ← 競合LP比較 (stitch 9)
      LpDiscovery.jsx        ← 競合ディスカバリー (stitch 10)
      LpPerformance.jsx      ← 広告パフォーマンス考察 (stitch 11)
      LpCreative.jsx         ← クリエイティブ診断 (stitch 12)
      LpPricing.jsx          ← 料金プラン (stitch 13)
      components/
        LpNavbar.jsx          ← 共通ナビゲーションバー
        LpFooter.jsx          ← 共通フッター
        LpCta.jsx             ← 共通CTAセクション
        LpSection.jsx         ← セクションラッパー (余白・max-width)
  styles/
    landing.css               ← LP専用スタイル (Terraテーマトークン)
```

## 実装手順

### Step 1: インフラ整備
**変更ファイル:** `src/App.jsx`, `index.html`, `src/styles/landing.css`

1. `index.html` に Literata / Nunito Sans フォントを追加
2. `src/styles/landing.css` を作成 — Terra テーマの CSS カスタムプロパティ定義
3. `src/App.jsx` に Layout 外の公開ルートを追加:
   ```
   /lp           → LandingPage (メインLP)
   /lp/compare   → LpCompare
   /lp/discovery → LpDiscovery
   /lp/performance → LpPerformance
   /lp/creative  → LpCreative
   /lp/pricing   → LpPricing
   ```

### Step 2: 共通コンポーネント作成
**変更ファイル:** `LpNavbar.jsx`, `LpFooter.jsx`, `LpSection.jsx`

- Stitch の共通ナビバーパターン（sticky, 透過→ソリッド変化）を React 化
- ナビリンク: 機能紹介 | 製品デモ | 料金 | 「無料で始める」CTA
- React Router の `<Link>` / `<NavLink>` でページ間遷移
- フッターは stitch (11) の詳細版を基準にする

### Step 3: Stitch HTML → React 変換（各ページ）

**変換方針:**
- 各 `code.html` の `<main>` 内コンテンツを JSX に変換
- Tailwind ユーティリティクラスはそのまま維持
- `class` → `className` 変換
- 画像の `src` (Google Cloud Storage URL) → `/public/lp/` にローカル化、または当面そのまま利用
- `<details>` 要素 (FAQ) → React state で制御するアコーディオンに変換
- 共通ナビバー・フッターは共通コンポーネントに差し替え

**変換順序（優先度順）:**
1. 🥇 メインLP (`LandingPage.jsx`) — エントリーポイント
2. 🥈 料金プラン (`LpPricing.jsx`) — コンバージョン直結
3. 🥉 競合LP比較 (`LpCompare.jsx`) — 主力機能
4. 広告パフォーマンス考察 (`LpPerformance.jsx`)
5. クリエイティブ診断 (`LpCreative.jsx`)
6. 競合ディスカバリー (`LpDiscovery.jsx`)

### Step 4: テーマ・スタイル調整
- LP ページではライトテーマを強制 (`useEffect` で `data-theme="light"` 設定、unmount 時に復元)
- `landing.css` に scroll-behavior: smooth、fade-in アニメーション追加
- IntersectionObserver によるスクロール連動アニメーション

### Step 5: ページ間ナビゲーション整備
- ナビバーのリンクをすべて接続
- メインLP の機能カード → 各機能詳細ページへの遷移
- 全ページの CTA → `/lp/pricing` または `/` (ダッシュボード) へ誘導
- スムーズスクロール（同一ページ内アンカー）

### Step 6: 画像アセット整理
- Stitch のモックアップ画像をローカルに保存 (`public/lp/`)
- 実際のダッシュボードスクリーンショットに差し替え（任意）
- 画像の alt テキスト設定

## 変更対象の既存ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/App.jsx` | Layout 外に `/lp/*` ルート追加 |
| `index.html` | Literata / Nunito Sans フォント追加 |

## 技術的判断

1. **新規依存なし**: Tailwind ユーティリティ + vanilla React のみ。アニメーションライブラリ不要
2. **LP と既存アプリは CSS 分離**: `landing.css` に Terra トークンを閉じ込め、既存の `index.css` に影響しない
3. **Stitch の Tailwind CDN → Vite ビルドの Tailwind v4 に統合**: CDN 参照は除去し、プロジェクトの Tailwind に統合
4. **画像は当面 Stitch の外部URL を維持**: 後で差し替え可能。初期実装の速度優先

## 検証方法

1. `npm run dev` で開発サーバー起動
2. `http://localhost:3002/lp` でメインLP表示確認
3. 各サブページ (`/lp/compare`, `/lp/discovery` 等) への遷移確認
4. ナビバー・フッターの共通動作確認
5. 既存ダッシュボード (`/`) が影響を受けていないことを確認
6. `npm run build` でビルドエラーがないことを確認
7. Vercel プレビューデプロイで実環境確認
