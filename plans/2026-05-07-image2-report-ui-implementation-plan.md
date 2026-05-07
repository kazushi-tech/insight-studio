# Image2 Report UI Implementation Plan

作成日: 2026-05-07 JST
対象: Insight Studio / React + Tailwind CSS

## 目的

GPT Image2 で生成した複数枚のUI方向画像を参照し、Compare / Discovery / Creative Review / Ads AI のレポート体験を、スクロール前提の読みやすい広告運用レポートUIへ反映する。

## 参照画像

生成元ディレクトリ:

`C:\Users\PEM N-266\.codex\generated_images\019dfcf8-f127-7852-a82d-3c513701e4a4`

参照セット:

- AI考察: `2026-05-07 10:28`, `10:30`, `10:32` 生成の3枚
- Creative Review 初期方向: `2026-05-07 10:34`
- Discovery 初期方向: `2026-05-07 10:35`
- Compare 上下分割: `2026-05-07 11:01`, `11:03`
- Discovery 上下分割: `2026-05-07 11:05`, `11:07`
- Creative Review 上下分割: `2026-05-07 11:10`, `11:13`

## 実装方針

1. 画像を「一枚の詰め込みUI」として写すのではなく、スクロール位置ごとの情報分散として実装する。
2. 長文レポートは許容する。ただし、各セクションの先頭に判断ボード、根拠、未取得データ、次アクションを置き、本文はその後に続ける。
3. 既存の Material Symbols / Manrope / Tailwind / CSS Modules を使う。追加アイコン画像は原則作らない。
4. 新規生成した画像は参照画像として扱う。プロダクトに直接表示する素材としては使わない。
5. 右AIレールは既存の `AiContextRail` を活かし、各画面固有の質問へ寄せる。
6. body水平スクロールを発生させない。1366pxと1920pxで右レールがviewport内に収まること。
7. カード内カードを避ける。セクションはフル幅の帯、判断ボード、表、アクション行で構成する。
8. 角丸は既存デザインとの整合を優先しつつ、レポート内部の小要素は8px前後へ寄せる。

## TODO

### TODO 1: 共通レポートUI基盤

対象ファイル:

- `src/components/report/v2/ReportViewV2.jsx`
- `src/components/report/v2/ReportViewV2.module.css`
- `src/components/report/v2/ActionBoardV2.jsx`
- `src/components/report/v2/ActionBoardV2.module.css`
- `src/components/report/v2/ReportChapterStackV2.jsx`
- `src/components/report/v2/ReportChapterStackV2.module.css`

内容:

- Compare / Discovery で共通利用できるスクロール用セクションナビを追加。
- Compare向けに「結論ボード」「比較マトリクス」「根拠トレース」「実行プラン」「計測条件」を表示。
- Discovery向けに「市場定義」「分類レーン」「次に比較する候補」「採用/除外理由」「不足根拠」「再検索条件」を表示。
- envelopeが無い場合もMarkdownから抽出できる範囲で破綻しないfallbackを維持。

合格基準:

- Compare result screenshotで、長文前に比較判断ボードが見える。
- Discovery result screenshotで、候補分類とCompare handoffが見える。
- 既存のMarkdown本文が消えない。

### TODO 2: AI考察 UI

対象ファイル:

- `src/components/ai-explorer/v2/InsightTimeline.jsx`
- `src/components/ai-explorer/v2/InsightTimeline.module.css`
- `src/components/ai-explorer/v2/InsightTurnCard.jsx`
- `src/components/ai-explorer/v2/InsightTurnCard.module.css`

内容:

- AI考察3枚の参照に合わせ、回答済み画面の上部に「考察サマリー」「今週やる3施策」「根拠指標」「未取得データ」を配置。
- 中盤は表、観測事実、AI推論、未取得データを読みやすく分割。
- 下部は3施策の実行表、関連グラフチップ、composerを配置。

合格基準:

- Ads AI回答後スクショで、長文の前に意思決定ボードが見える。
- 履歴保存/復元の既存挙動を壊さない。

### TODO 3: Creative Review UI

対象ファイル:

- `src/pages/CreativeReview.jsx`
- 必要なら同ファイル内の既存小コンポーネント

内容:

- 上部を「画像プレビュー」「総合スコア」「最重要改善」「テスト仮説」「評価保留」に再配置。
- レーダーを巨大表示から、判断ボードを補助するコンパクトなスコア可視化へ寄せる。
- 下部にA/Bテスト計画、法務・表現リスク、エビデンス一覧、修正ブリーフを分ける。

合格基準:

- バナーレビュー結果スクショで、最初に直すべきことがレーダーより先に分かる。
- 既存のレビュー本文、エビデンス、改善案、テスト案を失わない。

### TODO 4: ページ統合と右AIレール

対象ファイル:

- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- `src/components/ai-assistant/AiContextRail.jsx`
- `src/components/ai-assistant/AiContextRail.css`

内容:

- 各ページの右AIレール質問を画面固有に調整。
- 1920px / 1366pxで右レールがviewport内に収まるよう確認。
- レール内チップ・ボタンの日本語が折り返しで破綻しないよう調整。

合格基準:

- Compare / Discovery / Creative Review で右AIレールが可視。
- body水平スクロールなし。

### TODO 5: 検証

対象:

- `/compare`
- `/discovery`
- `/creative-review`
- `/ads/ai`
- `/debug/ui-ux-review`

内容:

- Browser Useで実画面を確認する。
- 必要に応じてPlaywrightでスクショとDOMメトリクスを取得。
- Gemini実APIの検証は、最終UI確認後に必要な範囲で再実行する。

合格基準:

- `npm run build` PASS
- `npm run lint` PASS
- 関連Vitest PASS
- Browser Useで右カラムに画面証跡を開く
- Critical/Major 0

## Worker割当

- Worker A: TODO 1 共通レポートUI基盤
- Worker B: TODO 2 AI考察 UI
- Worker C: TODO 3 Creative Review UI
- Worker D: TODO 4 右AIレール・ページ統合補助

全worker共通:

- reasoning level: low
- 他workerと同時に作業している前提で、担当外ファイルを戻さない。
- Browser Useでの画面確認が必要なことを前提に、実装後に確認観点を報告する。
- 既存未追跡ファイルや秘密値には触れない。
