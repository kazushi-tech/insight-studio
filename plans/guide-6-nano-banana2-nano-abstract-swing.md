# GUIDE インフォグラフィック画像 6枚 最新化プラン

## Context

`/public/guide/page1-6.png` のインフォグラフィック 6 枚は、2026-04-06 の **Claude-only 移行（commit 2a20242 ほか）** で UI 側からバナー自動生成機能と Gemini API キー入力欄が削除されたにもかかわらず、**画像の中身は旧仕様のまま**（Nano Banana2 によるバナー生成がフローに登場）になっている。

GuideModal.jsx の表示テキスト（`title` / `description`）は Claude First 前提で最新化済みだが、画像本体は `scripts/generate-guide-images.mjs` のプロンプトが古く、**再生成が必要**。

本プランでは、`.env` に定義済みの `IMAGE_API_KEY`（Gemini 3.1 Flash Image Preview = Nano Banana2）をそのままインフォグラフィック生成に使い、スクリプトのプロンプトを最新運用に合わせて書き換え、6 枚すべて（または変更があるページ）を再生成する。

## 現状と修正範囲

| Page | 現状プロンプトの問題 | 修正後の方針 |
|---|---|---|
| 1. welcome | 右カード：「Gemini Nano Banana 2で改善バナー」「Claude + Gemini の 2AI 連携」 | 右カード：Claude でレビュー（分析・評価）と書き直す。2AI 連携の表記を削除 |
| 2. api-setup | 3 カラム中央：「Gemini API キー / バナー画像の自動生成」カード | **Gemini カードを削除**し、2 カラム（Claude API キー + Ads Studio 認証）に再構成。TIP も Claude 強調に修正 |
| 3. lp-analysis | Claude 前提が暗黙 | BOTTOM NOTE に「**Claude API キーが必要**」を明記（既存「必要: Claude API キー」文言を残したまま軽微補強、プロンプト変更は任意） |
| 4. ads-insight | 内容は最新と一致 | **変更なし**（再生成スキップ可） |
| 5. creative | 中央「バナー自動生成 / Gemini Nano Banana 2 → 改善バナー」セクション、BOTTOM 「画像生成: Gemini API キー使用」 | 中央セクションを **削除**。LEFT (フロー) + RIGHT (出力形式 = レーダーチャート + 改善提案リスト、生成バナーは削除) の 2 カラムへ。BOTTOM は Claude 1 枠のみ |
| 6. tips | Card 3 接続ステータスに「Gemini」、FAQ に「画像生成¥5-10」 | Card 3 は「Claude / Ads」の 2 ステータス表示に変更。FAQ は「API 利用料のみ（分析¥30-50）」へ |

## 実装ステップ

### ステップ 1. `scripts/generate-guide-images.mjs` のプロンプト更新

対象: [scripts/generate-guide-images.mjs:64-278](scripts/generate-guide-images.mjs#L64-L278) の `PAGES` 配列

#### Page 1 修正（RIGHT CARD 書き換え）
```
RIGHT CARD (pastel purple #F3E5F5):
Title: "3. クリエイティブレビュー"
• バナー・LPをAIが診断しスコア＆改善提案
• 4軸分析: レイアウト/ビジュアル/テキスト/CTA
• レビュー結果からレーダーチャート＆優先度付き改善提案
• Claude がテキスト分析を担当（画像生成は行いません）
```
BOTTOM STRIP も「Settings でClaude APIキー設定 → …」と簡素化。

#### Page 2 修正（Gemini カード削除 → 2 カード構成）
```
Layout: 2 equal column cards (centered) + bottom flow + tip box

Card 1 (pastel yellow #FFF9C4): "Claude API キー"（内容維持）
Card 2 (pastel green #E8F5E9): "Ads Studio 認証"（内容維持）

BOTTOM FLOW: "① キー取得 → ② ヘッダー右の鍵アイコン → ③ 入力・保存 → ④ 全機能アンロック！"

TIP: "Claude API キーだけで Compare / Discovery / Creative Review / Ads AI の全主要機能が使えます"
```

#### Page 3, 4 修正
**変更なし** — 内容は最新運用と整合しており、再生成対象から除外する。

#### Page 5 修正（中央セクション削除、2 カラムに再構成）
```
Layout: 2 equal columns + bottom strip

LEFT SECTION (pastel orange #FFF3E0):
Title: "レビューフロー"
① 画像をアップロード（PNG, JPG, WebP対応）
② Claude が自動分析（20-40秒）
③ 診断結果: 総合スコア 86/100点

4軸で分析:
• レイアウト設計（構造、視線誘導）
• ビジュアル表現（色彩、コントラスト）
• テキスト戦略（見出し、訴求力）
• CTA効果（配置、サイズ、テキスト）

RIGHT SECTION (pastel green #E8F5E9):
Title: "出力形式"
• レーダーチャート（4軸の視覚化）
• 改善提案リスト（優先度: 高/中/低）
• ダウンロード可能な評価サマリー

BOTTOM STRIP (single box, full width):
"クリエイティブレビュー: Claude APIキー使用"
```
タイトルも `"クリエイティブレビュー"`（"& バナー生成" を削除）に変更。

#### Page 6 修正（Card 3 のステータス、FAQ 料金）
```
Card 3 (pastel green #E8F5E9):
Title: "接続ステータス"
• サイドバー下部: Claude / Ads の2つ
• 緑 = 接続済み / 赤 = 未接続
• クリックでSettings画面へジャンプ

BOTTOM FAQ:
Q: 料金は？ → Claude API 利用料のみ（1回の分析で約¥30-50）
Q: スマホ対応？ → PC専用（1280px以上推奨）
```

### ステップ 2. 画像再生成（変更のある 4 枚のみ）

既存ファイルが存在すると `generateImage` はスキップする挙動なので、**対象ファイルのみ削除してから通常実行**する（`--force` は全ページ強制なので使わない）。

```bash
rm public/guide/page1-welcome.png \
   public/guide/page2-api-setup.png \
   public/guide/page5-creative.png \
   public/guide/page6-tips.png
node scripts/generate-guide-images.mjs
```

- Page 3, 4 は既存ファイルが残るためスキップされ、既存画像がそのまま維持される
- 生成時間: 約 1.5–2 分（4 枚 × 20–30 秒 + レート制限 2 秒 × 3 回）
- 失敗時: スクリプトは 2 回リトライ済み。さらに失敗したら該当ページのみ `rm` → 再実行

### ステップ 3. 目視確認

`npm run dev` で開発サーバ起動 → ヘッドライト右上の本アイコンで `GuideModal` を開き、6 枚すべてを閲覧。

確認事項:
- [ ] Page 1: 「2AI連携」「Nano Banana 2」の記述が消えている
- [ ] Page 2: Gemini API キーのカードがない（Claude / Ads のみ）
- [ ] Page 5: 中央のバナー生成セクションが消え、レビュー内容だけになっている
- [ ] Page 6: 接続ステータスから Gemini が消え、FAQ 料金が Claude のみ
- [ ] Page 3, 4: 旧バージョンと遜色ない品質

### ステップ 4. コミット

```bash
git add public/guide/page1-welcome.png \
        public/guide/page2-api-setup.png \
        public/guide/page5-creative.png \
        public/guide/page6-tips.png \
        scripts/generate-guide-images.mjs
git commit -m "guide: regenerate infographics for Claude-only flow (remove Gemini/Nano Banana 2)"
```

## Critical Files

- [scripts/generate-guide-images.mjs](scripts/generate-guide-images.mjs) — プロンプト更新（Page 1, 2, 5, 6 の 4 箇所）
- [public/guide/page1-welcome.png](public/guide/page1-welcome.png) — 再生成対象
- [public/guide/page2-api-setup.png](public/guide/page2-api-setup.png) — 再生成対象
- [public/guide/page5-creative.png](public/guide/page5-creative.png) — 再生成対象（最重要）
- [public/guide/page6-tips.png](public/guide/page6-tips.png) — 再生成対象
- [public/guide/page3-lp-analysis.png](public/guide/page3-lp-analysis.png) — **変更なし**（スキップ）
- [public/guide/page4-ads-insight.png](public/guide/page4-ads-insight.png) — **変更なし**（スキップ）
- [src/components/GuideModal.jsx](src/components/GuideModal.jsx) — 変更不要（表示テキストは既に最新）
- [.env](.env) — `IMAGE_API_KEY` + `IMAGE_API_ENDPOINT`（変更不要、既に設定済み）

## Out of Scope

- GuideModal.jsx の表示テキスト修正（既に Claude First 準拠）
- バナー生成機能の実装復活（明示的に削除された仕様）
- Render 本番環境での画像再生成（ビルド済み静的ファイルを commit して Vercel デプロイで反映）

## 検証

1. ローカルで `node scripts/generate-guide-images.mjs --force` を実行し、成功ログ 6 件を確認
2. `npm run dev` でフロント起動、`http://localhost:3002/` のヘッダー右上「本」アイコンから GuideModal を開き、6 ページ順送りで内容確認
3. 矛盾があれば該当ページのプロンプトを再修正して単体再生成:
   ```bash
   rm public/guide/page5-creative.png
   node scripts/generate-guide-images.mjs
   ```
4. 問題なければ git add → commit → push、Vercel デプロイで本番反映
