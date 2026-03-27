# Claude実行プラン: AI考察 Markdown改善とバナーレビュー再開条件整理

## 0. 結論

今回の論点は 2 本です。

1. `AI考察` が「Markdown なのに箇条書きだらけ」に見えるのは、**backend 側が bullet-heavy な出力契約を強く要求している**うえに、**frontend の `MarkdownRenderer` がネスト箇条書きや引用ブロックを正しく表現できていない**ためです。
2. `クリエイティブ診断` / バナーレビューは、**Gemini API キーだけでは現状試せません**。今の Market Lens review API は `asset_id` 前提の契約に移っており、現行 frontend にはその `asset_id` を作る upload / asset selection workflow がありません。

したがって、Claude に投げるタスクは単なる文言修正ではなく、以下の 2 系統に分けて進めるのが妥当です。

- A. AI考察の「出力契約」と「表示器」を両方直す
- B. バナーレビューの「試せない理由」を契約ベースで整理し、最小の試験経路を作る

---

## 1. 今の事実関係

### 1.1 AI考察の生成入口

- `src/pages/AiExplorer.jsx`
  - `neonGenerate()` を呼んでいる
  - `point_pack_md` を渡している
  - `style_reference` は空文字
  - `style_preset` は `'standard'`
  - `ai_chart_context` も渡している

該当箇所:

- `src/pages/AiExplorer.jsx:147`
- `src/pages/AiExplorer.jsx:153`
- `src/pages/AiExplorer.jsx:154`
- `src/pages/AiExplorer.jsx:155`
- `src/pages/AiExplorer.jsx:159`

意味:

- 今の AI考察の文体・構造は、frontend ではなく **`/api/ads/neon/generate` 側の prompt / contract に大きく支配されている**。

### 1.2 frontend の Markdown 表示器

- `src/components/MarkdownRenderer.jsx` は以下しかまともに扱っていない
  - code block
  - heading
  - markdown table
  - 単純な箇条書き
  - paragraph

該当箇所:

- `src/components/MarkdownRenderer.jsx:127-259`

特に問題なのは list parsing です。

- list 判定時に `trim()` を使っているため、`  -` や `    -` の入れ子情報が消える
- 結果として backend が意図した階層 bullet が frontend では平坦化される

該当箇所:

- `src/components/MarkdownRenderer.jsx:225`
- `src/components/MarkdownRenderer.jsx:227`
- `src/components/MarkdownRenderer.jsx:228`

副作用:

- 「主張 -> 根拠 -> 詳細」の階層 bullet を UI で失う
- 引用ブロック (`> ...`) も特別扱いがなく、ただの段落扱いになる
- 出力が bullet-heavy かつ平坦に見えやすい

### 1.3 backend 側の出力契約はかなり bullet-heavy

現行の reference backend では、BQ 系 prompt と `neon/generate` の標準 prompt がかなり強くフォーマットを決めています。

根拠:

- `tmp_ads_insights_repo/web/app/prompts/system_bq.txt:48`
  - 箇条書きの階層化を必須にしている
- `tmp_ads_insights_repo/web/app/prompts/system_bq.txt:82`
  - `## 次アクション案` を固定セクションとして要求
- `tmp_ads_insights_repo/web/app/backend_api.py:12840`
  - 同様に「箇条書き（階層化必須）」を要求
- `tmp_ads_insights_repo/web/app/backend_api.py:12874`
  - `## 次アクション案` を固定
- `tmp_ads_insights_repo/web/app/gemini_client.py:110`
  - 出力 contract を固定している
- `tmp_ads_insights_repo/web/app/gemini_client.py:146`
  - `## TL;DR` から始めることを強制している

一方で、別経路の prompt にはむしろ次の指示もあります。

- `tmp_ads_insights_repo/web/app/backend_api.py:3455`
  - 数値比較は markdown table を使え
- `tmp_ads_insights_repo/web/app/backend_api.py:3456`
  - bullet を多用しすぎるな、説明は paragraph を使え

意味:

- backend 内でも **「表や文章を使え」という方針** と **「固定テンプレート + 階層 bullets を守れ」という方針** が混在している
- 今の `AiExplorer` が使う経路では後者の影響が強く、結果として user 体験は bullet-heavy に寄っている

### 1.4 バナーレビューの現在地

- `src/pages/CreativeReview.jsx` は unavailable page になっている
- UI 上も「一時停止中」と明示している
- 理由は review API が `asset_id` 前提に移行したため

該当箇所:

- `src/components/Layout.jsx:17`
- `src/pages/CreativeReview.jsx:21`
- `src/pages/CreativeReview.jsx:23`
- `src/pages/CreativeReview.jsx:24`

### 1.5 API helper はあるが、frontend には asset workflow がない

- `src/api/marketLens.js` には `reviewByType(type, payload, apiKey)` が残っている
- しかし現行 `src/` 内に `asset_id` を取得する upload / select UI はない

該当箇所:

- `src/api/marketLens.js:72`
- `src/api/marketLens.js:73`
- `src/api/marketLens.js:74`

repo search 上も、`src/` 側には `asset_id` / upload workflow の実装が見当たりません。

### 1.6 過去 plan とも整合している

既存の recovery plan でも、Creative Review については次の前提が確認済みです。

- 現行 backend の review endpoint は分化している
- 共有された request は `asset_id` ベース
- もし `asset_id` 等の前処理が必須なら、旧 URL 入力 UI を無理に復活させるべきではない

参考:

- `plans/2026-03-26-market-lens-recovery-plan.md`
- `plans/2026-03-26-market-lens-followup-review-plan.md`

---

## 2. Claude にやってほしいこと

### 2.1 ゴール A: AI考察を「本当に Markdown らしい」出力にする

期待する姿:

- 数値比較があるときは table を使う
- 解釈や示唆は paragraph で書く
- bullets は「論点列挙」や「次アクション」に限定する
- nested bullets や quote を出すなら frontend でも崩れず読める

避けたい姿:

- どんな質問でも `TL;DR -> 良かった点 -> 課題 -> 次アクション` の固定テンプレ
- 全 section が bullet のみ
- backend が階層 list を出しているのに frontend で全部平坦化される状態

### 2.2 ゴール B: バナーレビューの「試し方」を契約ベースで明確にする

期待する姿:

- user に対して「Gemini API キーだけで足りるか」を明確に答えられる
- 足りないなら、何が足りないのかを UI / plan / developer test path で説明できる
- banner review を今すぐ本実装できない場合でも、**最低限の検証経路** は作る

---

## 3. Workstream A: AI考察の出力契約を修正

### 方針

`AiExplorer` 側の見た目だけではなく、**`neon/generate` が返す markdown contract 自体を修正**する。

### 具体タスク

1. `question` モードの標準フォーマットを見直す
   - どんな質問でも固定 4 セクションにしない
   - 推奨構造は以下のような mixed format にする

例:

```md
## 結論

短い段落で結論を書く。

## 数字で見る変化

必要なときだけ table を使う。

| 指標 | 前月 | 当月 | 変化 |
| --- | ---: | ---: | ---: |
| セッション | 171 | 97 | -43.3% |

## 解釈

ここは paragraph 中心。
根拠が複数あるときだけ bullets を使う。

## 優先アクション

- 3 件以内の bullets
```

2. mode ごとに出力契約を分ける
   - `question`: mixed format を標準にする
   - `risk`: bullets 多めでもよい
   - `numbers`: table + short bullets を優先
   - `improve`: paragraph + action bullets に寄せる

3. `style_preset: 'standard'` の中身を再定義する
   - 今の `'standard'` が実質 bullet-heavy なら、そのままではダメ
   - `standard` を mixed analyst style に寄せる
   - もしくは `AiExplorer` から新しい preset / format flag を送る

4. 「表を使う条件」を明示する
   - 前月比・チャネル比較・デバイス比較・ランキング比較のときは table 優先
   - 単なる所感説明では table を無理に出さない

5. 「paragraph を使う条件」を明示する
   - 原因仮説
   - 背景説明
   - アクションの優先順位づけ

### 対象ファイル

- `tmp_ads_insights_repo/web/app/backend_api.py`
- `tmp_ads_insights_repo/web/app/prompts/system_bq.txt`
- 必要なら `tmp_ads_insights_repo/web/app/gemini_client.py`
- 必要なら `src/pages/AiExplorer.jsx`

### 注意

- `question` モードの改善と、既存 validation の整合を崩さないこと
- 既存の `TL;DR` 固定 contract に依存する downstream があるなら、そこも確認すること

---

## 4. Workstream B: MarkdownRenderer を markdown として最低限まともにする

### 方針

出力 contract を直しても renderer が壊していたら意味がないため、**frontend 側も同時に直す**。

### 具体タスク

1. nested list を保持する
   - 現在は `trim()` により入れ子が消える
   - 少なくとも 1 段・2 段のネストは見えるようにする

2. blockquote を正式対応する
   - backend prompt が quote を想定しているため、`> ...` をただの段落にしない

3. ordered list の対応を検討する
   - 優先度は nested ul / blockquote より低い
   - ただし実装コストが低ければ合わせて入れる

4. parser 方針を決める
   - 最小修正: 現行 parser を拡張
   - 推奨: `react-markdown` + `remark-gfm` へ寄せる

推奨理由:

- table / list / quote / emphasis の面倒を手書き parser で持ち続けないため
- 今回の問題は renderer が markdown semantics を十分に保持していないことなので、ライブラリ導入の合理性がある

### 対象ファイル

- `src/components/MarkdownRenderer.jsx`
- 依存追加する場合は `package.json`

### 受け入れ条件

- `  -` / `    -` が UI 上で入れ子として見える
- `> 重要` が quote として見える
- table / paragraph / list が混在しても崩れない

---

## 5. Workstream C: バナーレビューを「今どう試せるか」を明確化

### 結論

**Gemini API キーだけでは足りません。**

理由:

- 現在の Creative Review は `asset_id` 前提契約へ移行済み
- frontend には `asset_id` を得る workflow がない
- したがって `reviewByType('banner', ..., geminiKey)` を表面上つなぐだけでは再開できない

### Claude にやってほしいこと

1. Market Lens backend 契約を再確認する
   - `/api/ml/reviews/banner`
   - `/api/ml/reviews/ad-lp`
   - `/api/ml/reviews/compare`
   - それぞれの request schema を file path + line number で確定する

2. 今すぐの最小テスト経路を決める

選択肢 A:

- **developer-only manual tester**
- `asset_id` を手入力する簡易フォームを一時的に作る
- backend に既存 asset があるなら banner review を今すぐ試せる

選択肢 B:

- **本命の upload workflow**
- 画像 upload
- upload 結果から `asset_id` 取得
- その `asset_id` で `/reviews/banner` を叩く

推奨判断:

- まずは A で「本当に review API が使えるか」を確認
- backend 契約が安定してから B を実装する

3. unavailable 状態の UX を改善する
   - 「停止中」だけでなく、「Gemini キーだけでは足りない」ことを明記する
   - user が誤解しない文面に変える

4. 本実装できない場合でも、FAQ 的説明を UI / handoff / plan に残す
   - compare/discovery は URL ベース
   - creative review は asset ベース
   - ここを user が混同しないようにする

### 対象ファイル

- `src/pages/CreativeReview.jsx`
- `src/api/marketLens.js`
- 必要なら Market Lens backend repo 側

### やってはいけないこと

- `asset_id` 契約を確認せずに URL 入力 UI を無理やり復活させる
- 「Gemini API キーがあれば使えるはず」と frontend だけで決めつける

---

## 6. 実装順

1. backend / prompt 側で AI考察の mixed-format 方針を決める
2. `MarkdownRenderer` の nested list / quote を直す
3. `AiExplorer` の `style_preset` / format flag を必要に応じて更新する
4. sample response を使って UI 見え方を確認する
5. Market Lens review 契約を再確認する
6. `CreativeReview` の developer-only manual tester か upload workflow かを選ぶ
7. unavailable 文言を改善する
8. lint / build / route smoke test

---

## 7. Agent Team 推奨分担

今回のタスクは prompt/backend、frontend renderer、Market Lens 契約確認が分かれているため、並列化する価値があります。

### Lead / Integrator

責務:

- 最終方針の固定
- prompt contract と renderer 変更の整合確認
- banner review の再開条件を最終判断

### Agent 1: AI Output Contract Worker

責務:

- `tmp_ads_insights_repo/web/app/backend_api.py`
- `tmp_ads_insights_repo/web/app/prompts/system_bq.txt`
- 必要なら `tmp_ads_insights_repo/web/app/gemini_client.py`

で、bullet-heavy contract を mixed-format contract に見直す

成果物:

- 修正 prompt
- before / after の sample markdown

### Agent 2: Markdown Renderer Worker

責務:

- `src/components/MarkdownRenderer.jsx`
- 必要なら `package.json`

で nested list / quote / table の表示改善

成果物:

- renderer patch
- representative markdown を使った見え方確認

### Agent 3: Creative Review Contract Worker

責務:

- `src/pages/CreativeReview.jsx`
- `src/api/marketLens.js`
- 必要なら Market Lens backend repo

で banner review の request contract を確定し、manual tester か upload workflow のどちらが妥当か判断する

成果物:

- contract summary
- developer test path
- user 向け説明文案

### Agent 4: QA / Verifier

責務:

- `npm run lint`
- `npm run build`
- `/ads/ai`
- `/creative-review`
- sample markdown rendering

の回帰確認

---

## 8. Skills について

現セッションで使える skill catalog の中に、このタスクへ直接効く frontend markdown / Market Lens 契約専用 skill はありません。

したがって今回は:

- **skills 前提ではなく agent team + repo grounded review を優先**
- もし別 repo の docs / contract source が見えるなら、それを一次情報として使う

という方針で進めるのがよいです。

---

## 9. 受け入れ条件

### AI考察

- user が自然文で質問したとき、返答が bullets 一辺倒にならない
- 数値比較がある返答では table を 1 つ以上使える
- 解釈パートが paragraph として読める
- nested list や quote を出しても frontend で崩れない

### バナーレビュー

- 「Gemini API キーだけでは足りない」かどうかを根拠付きで説明できる
- `asset_id` 前提なら、その取得経路が plan 上で定義されている
- 少なくとも developer-only な manual test path か、本実装用 upload workflow のどちらかに着地する
- unavailable のまま残すなら、その理由が user に誤解なく伝わる

---

## 10. Claude への投げ方

以下の prompt をそのまま使ってよいです。

```md
`plans/2026-03-27-claude-plan-ai-markdown-and-banner-review.md` と
`plans/2026-03-27-session-handoff-auth-and-ai-explorer.md`
を読んで、この続きから対応してください。

今回の主目的は 2 つです。

1. `AI考察` の markdown が箇条書き過多に見える問題を、prompt/backend と frontend renderer の両面から直す
2. `クリエイティブ診断` / バナーレビューが今どうすれば試せるのかを、`asset_id` 契約ベースで整理し、可能なら最小の test path を作る

特に重視する点:

- 「Markdownらしい出力」にすること
  - table を使うべき所では table
  - 解釈は paragraph
  - bullets は必要最小限
- `MarkdownRenderer` が nested list / quote を潰していないか確認すること
- banner review は「Gemini API キーだけで動くはず」と決め打ちしないこと
- `asset_id` 契約が必要なら、それを前提に manual tester か upload workflow を設計すること

タスク量が多いので、必要なら agent team で
- AI output contract
- markdown renderer
- creative review contract
- QA
を並列で進めてください。
```

---

## 11. 一言まとめ

この件は「文体を少し変える」話ではありません。  
`AI考察` は **backend の出力契約が bullets を強制し、frontend がその構造をさらに潰している**のが本質です。  
また、`バナーレビュー` は **Gemini API キー不足ではなく、`asset_id` workflow 不在**が本質です。Claude には、この 2 つを切り分けたうえで着手してもらうのが正しいです。
