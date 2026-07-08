# Insight Studio 実ブラウザ改善レビュー結果

作成日: 2026-05-05

## 実施サマリー

- 対象: Dashboard / Compare / Discovery / Creative Review / Ads AI
- UI観察: `dist` を一時localhost配信し、隔離Chrome + localStorage seedで確認
- API観察: `.env` のGeminiキーを使い、Render APIへ直接実行
- 証跡:
  - UI観察JSON: `verify_output/browser-review-2026-05-05-ui-static/observations.json`
  - API観察JSON: `verify_output/browser-review-2026-05-05-api/api-observations.json`
  - Compare report: `verify_output/browser-review-2026-05-05-api/compare-report.md`
  - Discovery report: `verify_output/browser-review-2026-05-05-api/discovery-report.md`

## 実測結果

| 導線 | 結果 | 観測 |
| --- | --- | --- |
| Dashboard | 部分成功 | 画面表示は成立。接続状態で「Geminiで利用可」と出る一方、本文側は「Core 接続状況 1/2」「Ads AI 要認証」。最近の分析結果は `Market Lens API error: 502` を表示。 |
| Compare | API成功 / UI改善余地あり | APIは `202 -> completed`、約39秒、レポート本文 12,721文字。UIは入力後も観測上CTA disabledのままに見える箇所があり、説明文が「Claude APIキー」と表示されGemini利用状態と矛盾。 |
| Discovery | API成功 / レポート品質にMajor課題 | APIは `202 -> completed`、約71秒、4サイト取得、failed 0。レポートは生成されたが、ペタビットの業界が「BtoBマーケティング支援およびOEM製造分野」と混線し、グローカルを直競合扱いしている。 |
| Creative Review | 失敗 | asset uploadは `201` 成功。ad-lp reviewは `502`。Gemini出力が `improvements` / `evidence` / `target_hypothesis` / `message_angle` / `rubric_scores` 欠落でschema validation失敗。 |
| Ads AI | 未到達 | `/api/ads/auth/login` が `401 Invalid password`。既存helperのpasswordではRender認証不可。UI上も `考察スタジオ 未接続 / Ads AI 要認証`。 |

## Critical

### 1. Creative Review がGemini実行でschema validation failureになる

- 観察画面: Creative Review
- 実際の出力: upload `201` 後、review `502`
- なぜ問題か: ユーザーは画像をアップロードできた後にレビュー結果を期待するが、Geminiの構造化出力がbackend schemaを満たさず、改善提案・証拠・ルーブリックが全欠落した失敗になる。
- 修正方針:
  - Gemini provider用のreview promptで必須フィールドを明示し、JSON schemaをプロンプト内に短く固定する。
  - backendでschema validation失敗時に1回だけrepair promptを実行する。
  - UIでは「AI出力形式が崩れました。再生成しています」または「再試行」へ誘導し、raw Pydantic errorをそのまま見せない。
- 確認方法:
  - PNG upload -> ad-lp reviewをGeminiで実行し、`summary`、`improvements`、`evidence`、`rubric_scores`、`test_ideas` が表示されること。
  - validation failure fixtureを追加し、repair後にUIがレビュー結果へ進むこと。

## Major

### 2. Discovery の競合分類が広告運用判断に危険

- 観察画面: Discovery
- 実際の出力: ペタビット分析で「BtoBマーケティング支援およびOEM製造分野」と記載し、グローカルを「直競合EC（ペット用品OEM）」として比較。
- なぜ問題か: 競合セットがズレると、LP改善・広告予算・検索意図の提案が実務判断に使えない。広告運用者から見ると、これは単なる表現問題ではなくターゲット市場の誤分類。
- 修正方針:
  - Discovery候補を `direct / adjacent / reference / out-of-scope` に分類し、out-of-scopeは比較表から除外する。
  - 異業種候補は「参考観測」へ落とし、主要提案には使わない。
  - レポート冒頭に「今回の比較市場」を1文で固定し、候補ごとの採用理由を表示する。
- 確認方法:
  - ペタビットURLで再実行し、OEM製造など異業種候補が直競合扱いされないこと。
  - `対象整合性`、`競合層分類`、`根拠トレース` の否定テストを追加する。

### 3. Gemini利用中なのにUIコピーがClaude前提のまま

- 観察画面: Compare / Discovery / Creative Review
- 実際のUI:
  - サイドバー: `Compare / Discovery Geminiで利用可`
  - Compare説明: `LP比較分析は分析用 Claude API キーを...`
  - Discovery説明: `競合発見の分析は Claude で実行します`
  - Creative Review: `CLAUDE FIRST` / `Claudeでレビューします`
- なぜ問題か: 現在のAuthContextはGeminiキー優先で `analysisProvider=google` になる。実行providerと説明providerが食い違うため、ユーザーはどのキー・どのモデルで課金/生成されたか判断できない。
- 修正方針:
  - UIコピーは固定のClaude文言ではなく `getAnalysisProviderLabel(analysisProvider)` を使う。
  - 「Claude First」は設計思想として残す場合でも、実行状態には `現在: Geminiで実行` を併記する。
  - 設定画面とサイドバーで、Gemini優先ルールを明示するか、provider選択を可能にする。
- 確認方法:
  - Geminiのみ、Claudeのみ、両方設定の3状態で表示文言と送信payload providerが一致すること。

### 4. Dashboard が初見で「壊れている」印象を出す

- 観察画面: Dashboard
- 実際のUI: 接続状態は一部緑だが、最近の分析結果に `Market Lens API error: 502`、Ads欄にlock表示、同時に架空の最近のアクティビティが表示される。
- なぜ問題か: 初見ユーザーは「何が使えて、何が未接続なのか」を判断できない。実データ未接続なのに活動履歴があるように見える点も信頼を落とす。
- 修正方針:
  - Dashboard上部に「今日使える機能」を1枚で表示する: Compare/Discovery/Creative ReviewはGemini可、Ads AIは認証が必要。
  - API履歴取得失敗は赤エラーではなく、空状態 + 再試行 + 原因分類にする。
  - ダミーの最近のアクティビティは「サンプル」表示にするか、実履歴がない場合は非表示。
- 確認方法:
  - Ads未認証かつGemini設定済みで、赤い壊れた印象にならず、次アクションが1つに絞られること。

### 5. Ads AI の認証前提が検証不能で、復旧導線も弱い

- 観察画面: Ads AI / Setup Wizard
- 実際の出力: API auth `401 Invalid password`。UIでは `/ads/ai` がSetup Wizardへ戻り、ログインが必要と表示。
- なぜ問題か: `.env` に認証情報が存在しても、現在のhelper既定値ではRender認証できない。ユーザーが何を直せばよいか分かりにくい。
- 修正方針:
  - `scripts/provision_smoke_profile.mjs` を `AUTH_USERS` / case login / `APP_PASSWORD` の現行仕様に合わせて更新する。
  - Ads AI未接続時は「鍵アイコンから認証」だけでなく、現在足りない条件を `認証 / 案件 / 期間 / レポート生成` に分解して表示する。
  - smoke用の認証方式を1つに統一し、Renderとlocalで同じseed手順にする。
- 確認方法:
  - helper実行で `/api/ads/auth/login` または代替認証が成功し、`/ads/ai` のチャットUIまで到達すること。

## Minor

### 6. Compare / Discovery の入力後CTA状態が観測上分かりにくい

- 観察画面: Compare / Discovery
- 実際のUI: 自動入力後の観測では `分析開始` / `競合を発見` がdisabledとして記録された。
- なぜ問題か: 実ユーザー操作では問題ない可能性があるが、controlled inputの更新・ボタン活性条件・視覚状態がテストしづらい。
- 修正方針:
  - 入力欄に `aria-label` と `data-testid` を付ける。
  - CTA横に「あと何が必要か」を短く表示する。
- 確認方法:
  - ブラウザ自動操作でinputイベント後にCTAが活性化すること。

## GPT Image2 素材案

### Dashboard 接続状態ヒーロー用

Prompt:
`A clean SaaS dashboard illustration for a Japanese advertising analytics tool, showing three connected modules: competitor LP analysis, creative review, and ads insight chat. Botanical green and warm off-white palette, subtle gold accent, flat yet premium UI style, no text, no logos, desktop dashboard context, high clarity, professional B2B software aesthetic.`

用途:
- Dashboard上部の「今日使える機能」状態カード背景または空状態の補助ビジュアル。
- ただし主役はステータス文言とCTA。画像は薄く、情報を邪魔しない。

### Creative Review 空状態用

Prompt:
`A professional ad creative review workspace, one banner mockup on the left and structured evaluation blocks on the right, with visual hierarchy for score, evidence, improvement actions, and A/B test ideas. Botanical green, off-white, restrained gold accents, no readable text, polished SaaS product illustration, desktop UI context.`

用途:
- Creative Reviewのupload前ガイド。現在の「画像をアップロード / AIレビュー」2ステップだけでは、レビュー後に何が得られるか伝わりにくいため。

## 推奨実装順

1. Creative Review Gemini schema repairを修正。
2. Discovery競合分類ガードを修正。
3. provider表示の矛盾を全画面で修正。
4. Dashboardの接続状態/空状態を整理。
5. Ads AI provisioningと認証前提を再整備。

