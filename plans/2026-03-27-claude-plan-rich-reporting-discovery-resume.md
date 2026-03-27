# Claude実装プラン: Creative Review可読性改善 / Discovery復旧 / 画面遷移中の作業継続

## 背景

現状の `CreativeReview` は、レビュー内容そのものは十分に返ってきている一方で、見た目がほぼ単色で、`LP比較分析` のレポートに比べて情報の重みづけが弱い。  
特に「要約」「良い点」「課題」「改善案」「テストアイデア」といった意味の違うセクションが、ほぼ同じトーンで並んでいるため、情報量はあるのに読み取りコストが高い。

同時に、`競合発見 (Discovery)` はまだエラーが出ており、`Compare` / `Discovery` / `CreativeReview` のような重い処理を実行中に別画面へ移動すると、ページ単位の `useState` が消えて最初からやり直しになる。  
ユーザー要求は明確で、「別項目を見ている間も裏で作業を続け、戻ったら途中経過か結果をそのまま見たい」である。

このプランは、上記 3 点を一体として直すためのもの。

---

## 目的

1. `CreativeReview` のレビュー表示を、`LP比較分析` に近い読みやすさまで引き上げる。  
2. 色は増やしすぎず、`2〜3色` のアクセントだけで情報の階層を分ける。  
3. `Discovery` のエラー原因を contract ベースで潰す。  
4. `Compare` / `Discovery` / `CreativeReview` の長時間処理を、画面遷移しても継続できるようにする。  
5. ユーザーが戻ってきた時に、入力・進捗・結果が復元される状態を作る。

---

## source of truth

| 対象 | source of truth | 備考 |
| --- | --- | --- |
| Compare / Discovery API契約 | `tmp_market_lens_ai_repo` | frontend 推測ではなく clone 済み backend / reference frontend を優先 |
| Creative Review表示 | `src/pages/CreativeReview.jsx` + `src/components/MarkdownRenderer.jsx` | 現在は markdown 化済みだが視覚的重みづけが弱い |
| 画面遷移中の状態保持 | 現在は各 page の local state | ここを global run store に移す必要あり |

---

## repo-grounded 現状整理

### 1. Creative Review

`src/pages/CreativeReview.jsx` では、レビュー結果を markdown に再構成して `MarkdownRenderer` で表示している。  
内容自体は `summary`, `good_points`, `improvements`, `test_ideas`, `evidence`, `rubric_scores` まで拾えているが、表示トーンがほぼ中立グレー 1 色で、`Compare` の「レポートカード + 見出し + メタ情報」の方が視認性が高い。

### 2. Compare

`src/pages/Compare.jsx` は、上部メタ情報、レポート本体カード、必要なら score panel という構成で、読むべき領域が比較的分かりやすい。  
今回の `CreativeReview` 改善では、Compare の「情報の塊ごとに見せる」思想を流用しつつ、Creative Review ではセクション意味に応じた軽い色分けを入れる。

### 3. Discovery

`src/pages/Discovery.jsx` は現在 `discoveryAnalyze(url, geminiKey)` の同期呼び出しに依存し、成功時に `report_md` と `fetched_sites` を描画するだけの薄い実装になっている。  
一方、clone 済み backend では `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py` に stage-aware な pipeline があり、`brand_fetch`, `search`, `fetch_competitors`, `analyze` の各段階で timeout / fetch failure / partial failure が起こりうる。  
つまり、単に `ErrorBanner` を出すだけでは足りず、stage と partial success を前提に UI を設計し直す必要がある。

### 4. 画面遷移中の作業継続

`Compare.jsx`, `Discovery.jsx`, `CreativeReview.jsx` はいずれも page component の `useState` に実行状態を閉じ込めている。  
そのため、同一 SPA 内で別画面へ移っただけでも、ページが unmount された時点で進捗と結果が消える。  
ここは API を同期のまま使うとしても、page state を page の外に出して「run store」で保持すれば、少なくとも同一タブ内の画面遷移には耐えられる。

---

## 実装方針

### Workstream A: Creative Review を「比較分析レポート並みに読める表示」へ寄せる

#### 目標

`CreativeReview` の内容量は維持しつつ、読む順番が自然に分かる UI にする。  
カラーパレットは増やしすぎず、以下の 3 系統に限定する。

| 用途 | 色の方向性 | 使い方 |
| --- | --- | --- |
| 中立情報 | slate / neutral | 要約、製品特定、ターゲット仮説などの通常セクション |
| ポジティブ | emerald | 良い点、維持すべき点、成功要素 |
| 注意・改善 | amber もしくは rose 寄り | 課題、改善提案、リスク、テスト論点 |

#### 実装内容

1. `MarkdownRenderer` に page-wide な汎用色テーマを無理に入れず、まずは `CreativeReview.jsx` 側で section-aware wrapper を作る。  
`buildReviewMarkdown()` をさらに進めて、必要なら markdown 1 発ではなく「semantic blocks + markdown fragment」の構成へ寄せる。

2. 最低限、以下はブロック表示にする。
   - 要約
   - 良い点 / 現状維持
   - 改善提案
   - テストアイデア
   - エビデンス
   - ルーブリック評価

3. 見出しの下に、必要なら 1 行の小さな導入文や badge を置き、セクションの意味を先に伝える。

4. 長文は単純な灰色ベタ背景ではなく、Compare のレポートカードに近い余白構成へ寄せる。  
特に `review result` 全体を 1 つの巨大スクロール箱に閉じ込めるのではなく、必要ならセクションごとに区切って縦に読む構造へ分解する。

5. 文字サイズ切り替えは残すが、デフォルトでもやや読みやすい line-height と padding に調整する。

#### 完了条件

- `CreativeReview` を開いた時、`Compare` と同程度に「どこから読めばいいか」が分かる。  
- 良い点と改善提案が視覚的に区別できる。  
- 色は 2〜3 系統に収まり、うるさくならない。  
- table / paragraph / list の混在でも見た目が破綻しない。

---

### Workstream B: Discovery のエラーを contract ベースで復旧

#### 目標

`競合発見` を「なぜ失敗したのか分からないページ」から、「どの stage で失敗したか分かり、partial success も扱えるページ」にする。

#### 実装内容

1. まず network payload を確認し、現在の失敗が以下のどれかを特定する。
   - `401`: API key 周り
   - `404`: 競合候補なし
   - `502`: `brand_fetch` / `search` / `fetch_competitors` / `analyze`
   - timeout 系

2. `src/api/marketLens.js` の Discovery エラーマッピングを、backend の `stage=...` 付き detail に合わせて改善する。  
「ネットワークを確認してください」で丸めず、`ブランドURL取得で失敗`, `競合検索で失敗`, `競合サイト取得で失敗`, `比較分析で失敗` のように stage を見せる。

3. `Discovery.jsx` で partial success を扱う。
   - `fetched_sites` に失敗が混ざっていても、成功分の件数を表示
   - `industry`, `candidate_count`, `analyzed_count` をメタ情報として見せる
   - 取得失敗サイトは一覧で明示

4. frontend 問題ではなく backend 側 timeout / env が原因なら、`tmp_market_lens_ai_repo` 側の変更点も plan に含める。  
この場合は frontend repo と backend repo を分けて commit / deploy する。

#### 完了条件

- Discovery 実行時に、失敗時の理由が stage 付きで判別できる。  
- 一部取得失敗でも「全部失敗」扱いにならず、使える結果は表示される。  
- Claude が frontend/back-end どちらを直したかを明確に報告できる。

---

### Workstream C: 画面遷移しても作業が継続する run store を導入

#### 目標

`Compare`, `Discovery`, `CreativeReview` の重い処理を、ページローカル state から切り離し、同一タブ内でページを移動しても進捗と結果が保持されるようにする。

#### v1 の前提

この段階では「同一 SPA セッション内での継続」を最優先とする。  
タブを閉じた後や full reload 後まで完全復旧する必要はないが、少なくとも「別メニューを見て戻ると最初から」は解消する。

#### 実装内容

1. 新規 `AnalysisRunsContext` か同等の global store を作る。  
候補ファイル:
   - `src/contexts/AnalysisRunsContext.jsx`
   - `src/main.jsx` もしくは provider 配線箇所

2. store で保持する run type:
   - `compare`
   - `discovery`
   - `creativeReview.review`
   - `creativeReview.generation`

3. run object には最低限以下を持たせる。

| field | 説明 |
| --- | --- |
| `id` | frontend 側の一意 id |
| `kind` | compare / discovery / creative-review / banner-generation |
| `status` | idle / running / completed / failed |
| `input` | URL、asset_id、brand_info など |
| `startedAt` | 開始時刻 |
| `result` | 成功 payload |
| `error` | 失敗内容 |
| `meta` | run_id, search_id, generation_id など |

4. 実 API 呼び出しは page component から直接叩かず、store 経由で開始する。  
page は store を subscribe して描画だけ行う。

5. route change で unmount しても store は生きるので、戻ってきた時に
   - 入力欄
   - loading 状態
   - result
   - error
   を復元する。

6. `CreativeReview` の polling も page local に閉じず、store 側で継続させる。  
これにより生成中に別画面へ行って戻っても、進捗か完成結果を見られるようにする。

7. 余力があれば、ヘッダーかサイドバーに小さな「バックグラウンド実行中」インジケーターを追加する。

#### v2 の拡張案

full reload 後も再開したいなら backend job/status API が必要になる可能性が高い。  
今回の first pass では無理にそこまでやらず、まずは SPA 内継続を完成させる。

#### 完了条件

- Compare 実行中に `Discovery` へ移動しても、戻れば Compare の進捗か結果が残っている。  
- Creative Review のレビュー中 / 生成中に別画面へ移動しても、戻れば作業状態が復元される。  
- page unmount に依存した `setState` で状態が消えない。

---

### Workstream D: Compare / Discovery / CreativeReview の reporting 体験を揃える

#### 目標

レポートページごとの品質差を減らし、「どの分析でも同じ作法で読める」状態に寄せる。

#### 実装内容

1. 共通メタ情報帯を定義する。
   - run id
   - 実行時刻
   - 処理時間
   - 対象件数
   - stage / status

2. 共通の result shell を検討する。
   - 上部: メタ情報
   - 本文: markdown / structured sections
   - 下部: 次アクション or drill-down

3. Compare の見やすさを Creative Review に寄せるだけでなく、Discovery にも最低限の report shell を適用する。

4. `MarkdownRenderer` の size preset は維持しつつ、report type ごとに wrapper class を調整できるようにする。

#### 完了条件

- Compare / Discovery / Creative Review の 3 ページで、情報構造の見せ方が揃う。  
- 「このページだけ急に別UI」という印象が減る。

---

## 変更対象ファイル案

| ファイル | 役割 |
| --- | --- |
| `src/pages/CreativeReview.jsx` | section-aware な review result 表示、run store 接続 |
| `src/components/MarkdownRenderer.jsx` | 必要最小限の typography / table / callout 補強 |
| `src/pages/Compare.jsx` | page local state から run store 利用へ移行 |
| `src/pages/Discovery.jsx` | contract aligned error handling、partial success 表示、run store 利用 |
| `src/api/marketLens.js` | stage-aware error mapping、必要なら raw metadata を返しやすくする |
| `src/contexts/AnalysisRunsContext.jsx` | 新規。長時間 run の保持・復元 |
| `src/main.jsx` または provider 配線箇所 | run store provider 追加 |
| `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py` | backend 側修正が必要ならここ |

---

## Claude向け実行順

1. Discovery の失敗原因を raw response / network で確定する  
2. run store の土台を先に入れる  
3. Compare / Discovery を run store に移す  
4. Creative Review の review/generation を run store に移す  
5. Creative Review の reporting UI を色付きで磨く  
6. Compare / Discovery / Creative Review のメタ帯を揃える  
7. smoke test と build / lint を回す

この順がよい。  
先に UI だけ磨くと、あとで state 管理を移した時に再崩れしやすい。

---

## Agent team 推奨分担

Claude が parallel agents を使えるなら、以下のように分担する。

### Team A: Discovery contract / bugfix 担当

**Ownership**
- `src/pages/Discovery.jsx`
- `src/api/marketLens.js`
- 必要なら `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`

**Task**
- Discovery failure の実原因を特定
- frontend error mapping 修正
- partial success UI 実装
- backend 修正が必要なら別 commit / deploy 前提で分離

### Team B: Run store / background continuation 担当

**Ownership**
- `src/contexts/AnalysisRunsContext.jsx`
- provider 配線ファイル
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`

**Task**
- page local state 依存を剥がす
- run 継続・復元
- Creative Review polling の store 化

### Team C: Reporting / visual polish 担当

**Ownership**
- `src/pages/CreativeReview.jsx`
- `src/components/MarkdownRenderer.jsx`

**Task**
- 2〜3色アクセントで section hierarchy を付ける
- Compare っぽい report shell へ寄せる
- 読みやすい余白、line-height、table 表示に調整

### Main rollout の責務

- run store と UI polish の統合
- design tone の最終判断
- lint / build / manual smoke の通し確認

---

## Skills / ツール運用方針

このタスクは専用 skill よりも、repo-grounded なコード読解と browser/network 確認が重要。  
もし Claude 環境に browser automation / network inspection 相当の skill があるなら、Discovery failure の再現確認に使う。  
それ以外は skill ありきにせず、`tmp_market_lens_ai_repo` を一次情報として扱うこと。

---

## 検証項目

1. `CreativeReview`
   - 同じレビュー結果でも、セクションごとの差が視覚的に分かる
   - 文字サイズ `標準 / 大 / 特大` が崩れない
   - 別メニューへ移動して戻っても review / generation 状態が残る

2. `Compare`
   - 分析中に別画面へ移動して戻っても progress / result が残る
   - result shell が壊れない

3. `Discovery`
   - 失敗時に stage-aware なエラーメッセージが出る
   - partial success があれば report と fetched_sites を表示できる
   - 分析中に別画面へ移動して戻っても状態が残る

4. 共通
   - `npm run lint`
   - `npm run build`
   - できれば本番相当環境で 1 回ずつ manual smoke

---

## Claude にそのまま渡す依頼文

以下の方針で、この repo を実装してください。

1. `CreativeReview` のレビュー表示を、`LP比較分析` のレポートのように読みやすくしてください。  
単色で平坦なので、`2〜3色` のアクセントだけで十分です。  
色を増やしすぎず、`良い点 / 維持` は emerald 系、`課題 / 改善提案` は amber or rose 系、通常セクションは neutral 系で整理してください。  
巨大な 1 つのスクロール箱ではなく、必要なら section-aware なブロック表示にしてください。

2. `競合発見 (Discovery)` のエラーを、`tmp_market_lens_ai_repo` の contract を source of truth にして直してください。  
raw response を見て、どの stage で失敗しているのか確定した上で、frontend の error handling を修正してください。  
partial success があるなら、それも UI に反映してください。

3. `Compare`, `Discovery`, `CreativeReview` の長時間処理は、画面遷移しても裏で継続し、元の画面に戻ったら途中状態か結果が残るようにしてください。  
page local state ではなく global run store に移してください。  
まずは同一 SPA セッション内での継続で十分です。

4. 可能なら parallel agents で以下の分担を使ってください。
   - Team A: Discovery contract / bugfix
   - Team B: Run store / background continuation
   - Team C: CreativeReview reporting polish

5. backend 側変更が必要なら、`tmp_market_lens_ai_repo` は別 repo として扱い、frontend 側と分けて報告してください。

6. 最後に、変更ファイル一覧、確認した raw contract、残課題、lint/build/manual smoke の結果を簡潔に報告してください。
