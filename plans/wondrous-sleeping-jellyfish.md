# GUIDE機能: インフォグラフィック型オンボーディングガイド

## Context

Insight Studio は API キー2つ（Claude + Gemini）＋ Ads 認証が必要で、初回ユーザーには設定の流れが分かりにくい。ヘッダー右上に GUIDE ボタンを追加し、研究ポスター風の美しいインフォグラフィックで全機能の使い方を6ページのカルーセルで案内する。

**方式:** ハイブリッド — Gemini 3.1 Flash Image Preview で事前生成した PNG を静的アセットとして配置 + HTML/CSS でカルーセルモーダルを構築。ユーザーの API コスト0、即表示。

**画像生成に使用:**
- API: `gemini-3.1-flash-image-preview:generateContent`
- Key: `.env` の `IMAGE_API_KEY`
- 生成タイミング: 開発時（Claude Code が生成スクリプトで実行）
- 保存先: `public/guide/` に PNG として保存

---

## ファイル構成

```
public/guide/
  page1-welcome.png        ← 生成: Gemini Flash で事前生成
  page2-api-setup.png      ← 生成
  page3-lp-analysis.png    ← 生成
  page4-ads-insight.png    ← 生成
  page5-creative.png       ← 生成
  page6-tips.png           ← 生成

scripts/
  generate-guide-images.mjs ← 新規: 画像生成スクリプト

src/components/
  Layout.jsx              ← 変更: GUIDEボタン追加 + state
  GuideModal.jsx           ← 新規: モーダルシェル + カルーセル（画像表示）
```

---

## Step 0: 画像生成スクリプト — `scripts/generate-guide-images.mjs`

開発時に1回実行して `public/guide/` に PNG を生成・保存するスクリプト。

**API 仕様:**

- Endpoint: `gemini-3.1-flash-image-preview:generateContent`
- Method: POST
- Body: `{ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }`
- Response: `candidates[0].content.parts` から `inlineData.mimeType === "image/png"` を探して base64 デコード

**プロンプト設計（各ページ）:**

各プロンプトは以下の構造:
- 「日本語のインフォグラフィック」を明示
- 参考画像のスタイル: 研究ポスター風、カラフルなセクションボックス、アイコン、ステップ図解
- 具体的なコンテンツ指示（テキスト、セクション構成）
- サイズ: 横長レイアウト（モーダル表示に最適化）
- 配色: Deep Navy (#1A1A2E) + Muted Gold (#D4A843) をアクセントに

**6枚のプロンプト概要:**

1. **Welcome** — Insight Studio 概要、3本柱（LP分析・広告分析・クリエイティブ）の紹介
2. **APIキー設定** — Claude / Gemini / Ads 認証の3ステップ設定フロー
3. **LP比較 & Discovery** — URL入力→AI分析→スコア比較のフロー図
4. **広告分析** — Setup Wizard → Essential Pack → Graphs → AI Explorer のフロー
5. **クリエイティブレビュー** — 画像アップ→AI分析→バナー生成のフロー
6. **Tips** — サイドバー、テーマ切替、接続ステータスの使い方

**実行:**

```bash
node scripts/generate-guide-images.mjs
```

生成された PNG は `public/guide/` に保存され、Vite が静的アセットとして配信。

---

## Step 1: GuideModal.jsx — 画像カルーセルモーダル

既存の `KeySettingsModal`（Layout.jsx L123-299）パターンを踏襲：

- **オーバーレイ:** `fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm`
- **モーダルボックス:** `w-[900px] max-w-[92vw] max-h-[90vh]` — 画像表示に最適化
- **アクセシビリティ:** `role="dialog" aria-modal="true"`, Escape で閉じる, focus trap
- **カルーセル state:** `const [page, setPage] = useState(0)`
- **キーボード:** ArrowLeft/Right でページ送り、Escape で閉じる
- **ナビゲーション:** 下部にドット + 矢印ボタン + ページタイトル
- **トランジション:** `transition-opacity duration-200` でフェード切替

**画像表示構造:**

```jsx
const GUIDE_PAGES = [
  { src: '/guide/page1-welcome.png', title: 'Insight Studio へようこそ' },
  { src: '/guide/page2-api-setup.png', title: 'APIキーの設定' },
  { src: '/guide/page3-lp-analysis.png', title: 'LP比較 & 競合発見' },
  { src: '/guide/page4-ads-insight.png', title: '広告分析ワークフロー' },
  { src: '/guide/page5-creative.png', title: 'クリエイティブレビュー' },
  { src: '/guide/page6-tips.png', title: 'Tips & ショートカット' },
]
```

画像は `<img>` で表示、`rounded-[0.75rem] w-full object-contain` でモーダル内にフィット。
外部ライブラリ不要（useState + CSS のみ）。

---

## Step 3: Layout.jsx 変更

### ボタン追加（ヘッダー右側アイコン群に挿入）

挿入位置: API Key ボタン（L506）と Theme toggle（L519）の間

```jsx
<button
  onClick={() => setShowGuide(true)}
  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
  title="使い方ガイド"
  aria-label="使い方ガイドを開く"
>
  <span className="material-symbols-outlined">menu_book</span>
</button>
```

### State & Render

- `const [showGuide, setShowGuide] = useState(false)` — L332 付近
- `{showGuide && <GuideModal onClose={() => setShowGuide(false)} />}` — L547 付近

---

## Step 4: 初回自動表示（オプション）

```jsx
useEffect(() => {
  if (!localStorage.getItem('insight-studio-guide-seen')) {
    setShowGuide(true)
    localStorage.setItem('insight-studio-guide-seen', '1')
  }
}, [])
```

初回訪問時にガイドを自動表示し、オンボーディング体験を提供。

---

## 検証手順

1. `node scripts/generate-guide-images.mjs` — 6枚の PNG が `public/guide/` に生成される
2. `npm run build` — ビルドエラーなし確認
3. `npm run dev` → ヘッダー右上に `menu_book` アイコン表示確認
4. クリック → モーダル表示、6ページ全てナビゲーション可能
5. ArrowLeft/Right でページ送り、Escape で閉じる
6. 画像がモーダル内にきれいにフィットすること確認
7. 初回自動表示: localStorage クリア後にリロードで自動表示確認

---

## スコープ外

- バックエンド変更
- 新しいnpm依存追加
- ランタイムでの動的画像生成（事前生成の静的アセットのみ）
