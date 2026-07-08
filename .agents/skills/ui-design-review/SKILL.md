---
name: ui-design-review
description: UIコード品質・デザイン・アクセシビリティを総合レビューする。「UIレビュー」「デザインチェック」「アクセシビリティ確認」等でトリガー。
---

# UI Design Review

Web Interface Guidelines + Frontend Design 哲学に基づく UI 品質レビュースキル。

## トリガー

- 「UIレビューして」「デザインチェック」「アクセシビリティ確認」「サイトを見直して」

## ワークフロー

### Step 1: ガイドライン取得

最新の Web Interface Guidelines を取得:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

WebFetch でルールを取得してからレビューに使う。

### Step 2: 対象ファイル特定

ユーザーが指定したファイル、または全 HTML/CSS/JS ファイルを読み込む。

### Step 3: チェック項目

以下の観点でレビューする:

#### A. アクセシビリティ (WCAG 2.1 AA)
- セマンティック HTML（`<nav>`, `<main>`, `<article>` 等の適切な使用）
- `aria-label`, `aria-live`, `role` 属性の適切な設定
- キーボードナビゲーション対応（`tabindex`, `:focus-visible`）
- 色コントラスト比（テキスト 4.5:1、大テキスト 3:1 以上）
- `alt` テキスト、フォーム `<label>` の存在
- `prefers-reduced-motion` への対応

#### B. デザイン品質（Frontend Design 哲学）
- **タイポグラフィ**: 個性的なフォント選択（Inter/Roboto/Arial/system-ui 禁止）
- **カラー**: CSS変数で一貫管理、主要色＋アクセントカラーの明確な体系
- **モーション**: 意味のあるアニメーション、過剰でないか
- **空間構成**: 余白の使い方、レスポンシブの崩れがないか
- **背景・質感**: ベタ塗りだけでなく、グラデーション・テクスチャ・パターンの活用

#### C. パフォーマンス
- 不要な CSS/JS の排除
- 画像の最適化（`loading="lazy"`, 適切なフォーマット）
- フォント読み込み（`preconnect`, `display=swap`）
- CSS の `clamp()` によるフルードタイポグラフィ

#### D. SEO
- `<title>`, `<meta description>` の存在と適切な長さ
- OG タグ（`og:title`, `og:description`, `og:image`）
- JSON-LD 構造化データ
- セマンティックな見出し階層（h1 → h2 → h3）

#### E. モバイルファースト
- `viewport` メタタグ
- タッチターゲット 44px 以上
- レスポンシブブレークポイントの整合性
- 横スクロール発生しないか

### Step 4: 出力フォーマット

```
## UI Design Review Report

### Score: XX/100

#### Critical Issues (must fix)
- file.html:42 — [A11y] フォーム入力に label が未設定

#### Warnings (should fix)
- style.css:15 — [Design] Inter フォントが使用されている

#### Suggestions (nice to have)
- index.html:80 — [Perf] hero 画像に loading="lazy" を追加推奨

### Summary
全体評価と改善の優先順位
```
