# Stitch 2 デザイン強化指示書 — モダンダイナミック路線

## Context

Insight Studioの現在のUIは機能的だが「地味」「AI臭い」「テンプレ感」がある。
アニメーション・マイクロインタラクション・視覚的な奥行きが不足しており、
ユーザーを引き込む体験になっていない。

**目標:** Framer / Linear / Raycast 的な「洗練された動き」をStitch 2エクスポートに組み込み、
全画面のデザイン品質を底上げする。

---

## Stitch 2 への指示文（コピペ用）

以下をStitch 2のプロンプトとしてそのまま使える形式で記載。
画面ごとにカスタマイズ可能なモジュール構成。

---

### 📋 共通デザインディレクティブ（全画面共通で先頭に貼る）

```
## デザインディレクティブ: モダンダイナミック

### アニメーション・トランジション要件
以下のアニメーションをTailwind CSSのユーティリティ＋インラインCSS keyframesで実装すること:

1. **スクロール連動フェードイン**
   - 全セクション・カードに `opacity: 0; transform: translateY(24px)` → スクロールで `opacity: 1; transform: translateY(0)` 
   - Intersection Observer用の `data-animate="fade-up"` 属性を付与
   - duration: 600ms, easing: cubic-bezier(0.16, 1, 0.3, 1)
   - カード群はスタガー表示（各要素に100msずつ遅延、`data-delay="100"` `data-delay="200"` ...）

2. **ホバーエフェクト**
   - カード: `hover:translate-y-[-8px] hover:shadow-2xl transition-all duration-300`
   - ボタン（Primary）: `hover:scale-105 active:scale-95 transition-transform duration-150`
   - ナビリンク: 下線がスライドイン（`after:` 疑似要素で `width: 0→100%` アニメーション）
   - アイコン: `hover:rotate-12 transition-transform duration-200`

3. **グロウ・光エフェクト**
   - CTAボタンに微細なグロウ: `shadow-[0_0_20px_rgba(テーマカラー,0.3)]`
   - フォーカス状態で光のリング: `focus:ring-2 focus:ring-offset-2 focus:ring-[テーマカラー]/50`
   - 重要カードのボーダーにグラデーション光（CSS `border-image` or `background: conic-gradient`）

4. **ページ遷移準備**
   - 各ページのルートコンテナに `data-page-transition="slide-fade"` を付与
   - 初期状態: `opacity: 0; transform: translateX(20px)`
   - CSS:
     ```css
     @keyframes page-enter {
       from { opacity: 0; transform: translateX(20px); }
       to   { opacity: 1; transform: translateX(0); }
     }
     [data-page-transition] { animation: page-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both; }
     ```

5. **マイクロインタラクション**
   - トグルスイッチ: `transition-transform duration-200 ease-out` + 色のスムーズ変化
   - チェックボックス: チェック時に小さなバウンス（scale 1→1.2→1）
   - ドロップダウン開閉: `max-height` + `opacity` の同時トランジション 250ms
   - ツールチップ: `scale(0.95)→scale(1)` + `opacity` 150ms

### レイアウト・視覚要件
- **背景にアンビエントグラデーション**: 固定背景にぼかしたカラーオーブ（2-3個）を配置
  例: `position: fixed; width: 400px; height: 400px; border-radius: 50%; filter: blur(100px); opacity: 0.15;`
- **カード間に十分な余白**: gap-6以上、視覚的な呼吸を確保
- **セクション区切り**: 直線的なhrではなく、グラデーションフェード or 余白で区切る
- **テキスト階層**: 見出しは太く大きく(font-bold text-3xl+)、本文との差を明確に
- **非対称レイアウト**: 完全な左右対称を避け、意図的なオフセットで動きを出す

### アクセシビリティ要件
- 全インタラクティブ要素に `focus-visible:` スタイルを設定
- `@media (prefers-reduced-motion: reduce)` でアニメーション無効化
- `aria-label` をアイコンボタンに必ず付与
- カラーコントラスト比 WCAG AA (4.5:1) 以上を確保
- `prefers-color-scheme` 対応のダークモード配色

### 使わないこと（NG項目）
- ❌ 1px solid ボーダーで囲む安易なカードデザイン
- ❌ 均等グリッドの繰り返しだけの単調レイアウト
- ❌ デフォルトの影 (shadow-md) そのまま使用
- ❌ テンプレ感のあるヒーローセクション（中央揃えタイトル + サブテキスト + ボタン1個だけ）
- ❌ アイコンを並べただけの特徴セクション
```

---

### 🏠 LP（ランディングページ）専用追加指示

```
## LP固有ディレクティブ

### ヒーローセクション
- 画面の80vh以上を占有する大胆なヒーロー
- 背景: アニメーションするグラデーションメッシュ or パーティクル演出（CSS only）
  ```css
  @keyframes gradient-shift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .hero-bg {
    background: linear-gradient(-45deg, #色1, #色2, #色3, #色4);
    background-size: 400% 400%;
    animation: gradient-shift 15s ease infinite;
  }
  ```
- メインコピーは1行で圧倒的な存在感（text-5xl md:text-7xl font-extrabold）
- キーワードにグラデーションテキスト: `bg-clip-text text-transparent bg-gradient-to-r`
- CTAボタンは2つ（Primary: 塗り + Secondary: ゴースト/アウトライン）

### スクロール演出
- 各セクションのカードがスタガーでフェードイン
- 数値実績セクション: カウントアップアニメーション用に `data-count-target="1234"` 属性付与
- 比較テーブルやBentoグリッドには `hover:scale-[1.02]` のリフト効果
- スクロールインジケーター（下矢印のバウンスアニメーション）をヒーロー下部に配置

### 社会的証明・信頼セクション
- ロゴ群の無限スクロール（marquee）: `@keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`
- テスティモニアルカードにグラスモーフィズム: `backdrop-blur-xl bg-white/60`
```

---

### 📊 ダッシュボード専用追加指示

```
## ダッシュボード固有ディレクティブ

### データ表示のアニメーション
- KPIカード: 数値のカウントアップアニメーション準備（`data-animate="count-up"`）
- チャート領域: `data-animate="draw-in"` で描画アニメーション準備
- テーブル行: スタガーフェードイン（行ごとに50ms遅延）
- ステータスバッジ: パルスアニメーション（`animate-pulse`）は「進行中」のみ

### インタラクション
- サイドバー: 折りたたみ時のスムーズトランジション（width + opacity 300ms）
- フィルターパネル: スライドダウン + フェードイン 250ms
- カード選択: 選択時にボーダーがアニメーションで出現（scale 0→1）
- ソート変更: テーブル行の並び替えにスムーズな位置移動アニメーション準備

### 情報密度のバランス
- データが多い画面ほど余白を意識（padding-6以上）
- グラフとテキストの間にvisual separator（グラデーションライン or 余白）
- 「もっと見る」のプログレッシブディスクロージャーパターンを活用
```

---

### 🔐 ログイン/認証画面専用追加指示

```
## 認証画面固有ディレクティブ

### 全体演出
- 左右分割レイアウト: 左にブランドビジュアル（アニメグラデ背景）、右にフォーム
- ブランド側: 浮遊するシェイプ or パーティクル背景（CSS animation）
  ```css
  @keyframes float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-20px) rotate(5deg); }
  }
  ```
- フォームカード: `backdrop-blur-lg bg-white/80` のグラスエフェクト

### フォームインタラクション
- input focus: ラベルがスムーズにフロートアップ（translateY + scale）
- バリデーション: 成功=緑チェックがフェードイン、エラー=赤でシェイクアニメーション
  ```css
  @keyframes shake { 0%,100% { transform: translateX(0); } 25%,75% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }
  ```
- ボタン送信中: テキスト→スピナーへのクロスフェード
- パスワード表示トグル: アイコン切り替えにfade 150ms
```

---

## Stitch 2 プロンプトの組み立て方

```
[共通デザインディレクティブ] をまず貼り付け
         ↓
[画面固有ディレクティブ] を追加
         ↓
画面の具体的な要件（表示するデータ、機能）を記述
         ↓
生成
```

**例（LPの場合）:**
```
[共通デザインディレクティブをここに貼る]

[LP固有ディレクティブをここに貼る]

## 画面要件
- Insight Studio（広告運用・競合分析SaaS）のランディングページ
- ターゲット: 広告代理店・インハウスマーケター
- セクション構成: ヒーロー → 3つの主要機能 → Bentoグリッド → 料金プラン → CTA
- カラーパレット: Deep Navy (#1A1A2E) + Muted Gold (#D4A843)
- フォント: Manrope
```

---

## React側で後から実装が必要なもの（参考）

Stitch 2はHTMLエクスポートなので、以下はReact移植時に追加実装が必要:

| 機能 | 実装方法 | 優先度 |
|------|---------|--------|
| スクロールフェードイン | Intersection Observer + CSS class切替 | 高 |
| ページ遷移 | React Router + CSS animation or framer-motion | 高 |
| カウントアップ数値 | requestAnimationFrame ループ | 中 |
| パーティクル背景 | CSS only or tsparticles (軽量) | 低 |
| マーキースクロール | CSS animation (JS不要) | 低 |

---

## 検証方法

1. Stitch 2で生成 → `screen.png` で視覚確認
2. `code.html` をブラウザで開き、ホバー・アニメーション動作確認
3. Chrome DevTools > Rendering > `prefers-reduced-motion: reduce` でアクセシビリティ確認
4. Lighthouse でアクセシビリティスコア確認（目標: 90+）
