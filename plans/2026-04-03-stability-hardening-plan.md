# Insight Studio Stability Hardening Plan

**作成日:** 2026-04-03  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**関連参照:** `tmp_ads_insights_repo` の安定化パターン、既存 `plans/2026-03-26-market-lens-followup-review-plan.md`  
**目的:** Insight Studio の AI 出力を「たまたま動く」状態から、「Claude を中心に安定して使える」状態へ段階的に引き上げる  
**方針:** 一気に広く直さず、1フェーズごとに受け入れ条件を満たしてから次へ進む

---

## 1. 背景整理

現状の `Insight Studio` は、以下が同時に存在している。

- `Claude` と `Gemini` の複数キー導線
- `proxy` と `direct` の複数通信導線
- `アップロード → レビュー → 生成 → 再スコア` の長い状態遷移
- `Market Lens` 系の open-world 入力（LP取得、競合取得、画像取得）

その結果、「モデルの質」より先に、以下が不安定さの主因になっている。

1. 設定条件が多く、利用条件が分かりにくい
2. 通信経路が複数あり、cold start / CORS / timeout の揺れを受けやすい
3. モデルに渡す前の中間データが未整備で、入力品質が毎回揺れる
4. 生成後の validator / retry / fixture が弱く、壊れても再現しにくい

一方、`ads-insights` は比較的安定して見える。

- `point_pack_md` という中間表現を作ってから AI に渡している
- 生成後の validator と retry がある
- data provider に `mock` があり、再現しやすい
- フロントの通信導線が比較的単純

今回の plan では、この「安定する構造」だけを段階的に持ち込む。

---

## 2. この plan のゴール

### P0

- `Claude API キーだけ` で、主要機能の大半が使える
- `Gemini` は改善バナー生成などの追加機能に限定される
- 失敗時に、何が原因かを UI 上で切り分けられる

### P1

- `Compare / Discovery / Creative Review(review only) / Ads AI` が、再現可能な smoke 手順で確認できる
- 同じ入力で結果が大きく崩れた時に、どこで崩れたか追える

### P2

- `ads-insights` のように、中間表現 → 生成 → 検証 の流れが Insight Studio 側にも入る
- 新しい修正を入れても、最低限の安定性を壊しにくい

---

## 3. 非ゴール

- いきなり全画面を再設計しない
- いきなり `Market Lens backend` 全体を書き換えない
- 画像生成まで含めて一度に安定化しない
- prompt 改善だけで全て解決しようとしない

---

## 4. 安定の定義

以下を満たした時点で「このフェーズは完了」とみなす。

1. 同じ手順で 3 回試して、少なくとも 2 回以上成功する
2. 失敗した場合も、原因カテゴリが UI またはログで分かる
3. 再実行時に入力や状態が不必要に消えない
4. ユーザーに不要な API キー設定を要求しない

---

## 5. 先に固定する受け入れシナリオ

この 5 シナリオを毎フェーズの確認軸にする。

### Scenario A: Ads AI

- 前提: Ads 認証済み、Claude キーあり
- 入力: 要点パックが生成済みの案件
- 期待: 質問送信で考察が返る

### Scenario B: Compare

- 前提: Claude キーあり
- 入力: 比較対象 URL
- 期待: 比較結果が返る、少なくとも空欄だらけで終わらない

### Scenario C: Discovery

- 前提: Claude キーあり
- 入力: ブランド URL
- 期待: 成功または stage 付きの明示的エラーになる

### Scenario D: Creative Review

- 前提: Claude キーあり
- 入力: バナー画像 1 枚
- 期待: レビューが返る

### Scenario E: Creative Generation

- 前提: Gemini キーあり
- 入力: Creative Review 完了済み
- 期待: 生成機能はオプションとして動く。失敗しても core flow を壊さない

---

## 6. フェーズ分割

### Phase 0. Baseline 固定

**目的:** 何が壊れているのかを毎回同じ条件で再現できるようにする

**作業内容**

- 5シナリオそれぞれの再現手順を `plans/` か `docs/` に固定する
- 現状の成功率、失敗メッセージ、処理時間を記録する
- 既知エラーを以下のカテゴリに分類する
  - config missing
  - auth error
  - timeout
  - cold start
  - CORS / network
  - upstream provider
  - invalid input
  - schema / response mismatch
- 手動 smoke 手順を 10 分以内で回せる形に圧縮する

**対象ファイル**

- `plans/`
- 必要なら `README.md`

**受け入れ条件**

- 5シナリオの再現手順が文章として固定されている
- 「成功した / 失敗した」だけでなく、失敗カテゴリを記録できる

**担当推奨**

- `Codex`

**理由**

- repo 内の現状整理と、再現手順の固定は Codex の方がぶれにくい

---

### Phase 1. Claude First への仕様整理

**目的:** 主要機能を `Claude only` に寄せ、利用条件を簡潔にする

**作業内容**

- `Claude API キー` を core 機能の唯一の AI 要件にする
- `Gemini API キー` は「改善バナー生成のみ」に限定する
- ヘッダーや設定画面の状態表示を、実態に合わせて見直す
- `Gemini 未設定 = 全機能未完成` の見え方をやめる
- ガイド文言、説明文言、警告文言を整理する
- 必要なら `改善バナー生成` を experimental 扱いにする

**対象ファイル候補**

- `src/contexts/AuthContext.jsx`
- `src/components/Layout.jsx`
- `src/pages/CreativeReview.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/Settings.jsx`
- `GuideModal` 系コンポーネント

**受け入れ条件**

- Compare / Discovery / Ads AI / Creative Review が Claude キーだけで進められる
- Gemini 未設定でも「主要機能は使える」と UI で分かる
- 改善バナー生成だけが明確にオプション扱いになる

**担当推奨**

- `Codex`

**理由**

- UI 条件分岐、文言、状態表示の修正は deterministic なので Codex 向き

---

### Phase 2. フロントの状態遷移とエラー分類の整理

**目的:** 「不安定」に見える原因を、状態とエラーの設計で潰す

**作業内容**

- Compare / Discovery / Creative Review / AiExplorer の run 状態を見直す
- `idle / loading / success / empty / unavailable / error` の意味を揃える
- 同じ失敗でも、`404` と `500` と `timeout` を同じ見え方にしない
- retry しても入力値や preview が消えないようにする
- `error banner` を機能ごとに統一して、対処文言を整える
- 現在の `AnalysisRunsContext` の責務が足りないなら最小限だけ補強する

**対象ファイル候補**

- `src/contexts/AnalysisRunsContext.jsx`
- `src/api/marketLens.js`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- `src/pages/AiExplorer.jsx`

**受け入れ条件**

- 同じ種類の障害が、どの画面でも似た見え方になる
- retry で入力内容が消えない
- `unavailable` は本当に unavailable な場合だけに使う

**担当推奨**

- `Codex`

**理由**

- 状態遷移と実装整合の修正は、repo-grounded に詰める必要がある

---

### Phase 3. 通信経路と timeout / retry の簡素化

**目的:** ネットワーク由来の揺れを減らし、失敗時の原因特定をしやすくする

**作業内容**

- `proxy` と `direct` の使い分けを棚卸しし、機能ごとに方針を固定する
- 可能なら AI 系 long-running endpoint の経路を整理する
- `ensureDirectBackend()` の挙動を明示し、失敗時に path をログ・画面に残す
- timeout 値を endpoint ごとに再定義する
- retry する条件を限定する
- request ごとに request id / correlation id を持たせる案を検討する

**対象ファイル候補**

- `src/api/marketLens.js`
- 必要なら `vercel.json`
- 必要なら backend contract 文書

**受け入れ条件**

- Compare / Discovery / Review で「どの経路を通ったか」が追える
- timeout / CORS / backend unavailable が同じエラーにならない
- cold start 時の案内が揃う

**担当推奨**

- 実装: `Codex`
- backend contract の再確認: `Claude` 併用可

**理由**

- 実装そのものは Codex 向き
- ただし contract 整理や外部依存の文章化は Claude の長文整理が使いやすい

---

### Phase 4. ads-insights 型の「中間表現」を導入

**目的:** モデルに生データを直接食わせず、揺れにくい入力へ整形する

**作業内容**

- Compare / Discovery / Creative Review(review) ごとに `analysis packet` を定義する
- packet には以下を含める
  - normalized input
  - fetch / extract 成功率
  - title / headings / body snippet
  - screenshot 有無
  - asset metadata
  - operator memo / brand info
  - 欠損項目の明示
- LLM 呼び出しの前に packet を生成し、最終 prompt は packet を元に組み立てる
- run meta か debug 出力に packet の要約を残す

**対象ファイル候補**

- `src/api/marketLens.js`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- 新規 `src/utils/analysisPacket*.js`
- 必要なら backend 側 prompt builder

**受け入れ条件**

- raw HTML / raw response 依存が減る
- 取得不足時も「不足が明示された packet」でレビューできる
- 出力ブレが減り、少なくとも failure mode が説明しやすくなる

**担当推奨**

- 設計: `Claude`
- 実装: `Codex`

**理由**

- packet schema や prompt の文章設計は Claude が得意
- 実ファイルへの組み込みは Codex の方が安全

---

### Phase 5. 出力 validator と軽い retry を追加

**目的:** モデルが壊れた出力を返しても、そのまま UI に流さない

**作業内容**

- `ads-insights` の validator 発想を縮小版で導入する
- まずは数値完全検証ではなく、以下を対象にする
  - 必須セクション欠落
  - rubric score の範囲外値
  - evidence 不足
  - 空に近い短文応答
  - 禁止 prefix / 生の provider error
- validator NG の時は
  - 1 回だけ軽い retry
  - だめなら structured error を返す
- 「成功だけど中身が薄い」ケースを明示する

**対象ファイル候補**

- `src/api/marketLens.js`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- backend 側の review / analysis service

**受け入れ条件**

- 明らかに壊れた出力がそのまま main UI に出にくくなる
- retry しているかどうかがログで追える
- 短すぎる応答や score 異常を検知できる

**担当推奨**

- validator rule 設計: `Claude`
- 実装: `Codex`

**理由**

- 自然言語出力の品質ルールは Claude が設計しやすい
- ルールのコード化と既存 UI への接続は Codex 向き

---

### Phase 6. fixture / mock / smoke automation を入れる

**目的:** 手動確認だけに依存しない最低限の安定確認を持つ

**作業内容**

- `ads-insights` の `mock provider` 発想を流用し、Insight Studio 側にも fixture を用意する
- 最初は本格 mock server でなくてよい
- まず以下を固定 fixture 化する
  - Compare 用 URL / response fixture
  - Discovery 用 fixture
  - Creative Review 用 sample banner
  - Ads AI 用 sample point pack
- `npm` から叩ける smoke test 導線を追加する
- 可能なら `Playwright` または軽い integration script を追加する

**対象ファイル候補**

- `package.json`
- `tests/` または `scripts/`
- fixture asset / sample markdown

**受け入れ条件**

- 主要 3〜5 フローを 1 コマンドまたは短い手順で確認できる
- 新しい修正後に最低限の回帰確認ができる

**担当推奨**

- `Codex`

**理由**

- テスト導線と fixture 配線は repo 内で閉じているため Codex 向き

---

## 7. 実行順

この順で進める。

1. `Phase 0` Baseline 固定
2. `Phase 1` Claude First への仕様整理
3. `Phase 2` 状態遷移とエラー分類
4. `Phase 3` 通信経路と timeout 整理
5. `Phase 4` 中間表現導入
6. `Phase 5` validator / retry
7. `Phase 6` fixture / smoke automation

この順にする理由は以下。

- 先に仕様を単純化しないと、後段の安定化作業が全部複雑化する
- 先に state / error を整理しないと、本当に「壊れている」のか「分かりづらいだけ」なのか区別できない
- validator は input と transport が固まってから入れる方が効果が高い
- automation は最後に入れるが、確認対象は Phase 0 で先に固定する

---

## 8. Claude と Codex の使い分け

### 結論

**主担当は `Codex` に寄せる方がよい。**  
ただし、`Claude` は「prompt / packet / validator 設計レビュー」に使うと強い。

### Codex 向き

- 既存 repo を読んで小さく安全に直す
- state, UI, API wrapper, condition 分岐の修正
- `acceptance criteria` を満たすための実装
- fixture / smoke test の整備

### Claude 向き

- 中間表現の schema 設計
- prompt 設計
- 出力 validator のルール設計
- 長文の設計文書やレビュー観点整理

### 運用推奨

1. 各フェーズの実装は `Codex` で進める
2. `Phase 4` と `Phase 5` の前だけ `Claude` に設計レビューをかける
3. 同じファイル群を Claude と Codex で同時編集しない
4. 1フェーズごとに smoke してから次へ進む

---

## 9. 最初の着手候補

まず着手すべきは `Phase 1` ではなく、厳密には `Phase 0 + Phase 1` の最小セット。

### 最初の 1 スプリントでやること

- Baseline シナリオを固定
- UI 表示を `Claude first` に修正
- `Gemini` を optional に見せる
- Creative Review の生成を core flow から切り離す

### ここで触る可能性が高いファイル

- `src/contexts/AuthContext.jsx`
- `src/components/Layout.jsx`
- `src/pages/CreativeReview.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`

### この段階ではやらないこと

- backend 全面改修
- validator の本格導入
- テスト基盤の大規模追加

---

## 10. 完了判定

この plan 全体の完了条件は以下。

- `Claude only` で core flows が安定して使える
- `Gemini` は optional addon として隔離されている
- 失敗時の見え方が揃っている
- `analysis packet` と validator により、出力の説明責任が上がっている
- 最低限の smoke automation が存在する

