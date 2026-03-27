# Insight Studio — Setup Wizard / Ads UX Parity Recovery Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**ブランチ:** `master`  
**現在の HEAD:** `8907bd62acb8141da1c8c29ef6ada004683a4869`  
**目的:** `Setup Wizard` を reference app 相当に戻し、Ads 連携 UI 全体の「見た目だけ」状態を解消して、**本当に考察スタジオ backend と整合した UX** に仕上げる

---

## 1. この plan が必要な理由

現在の deploy は、表面的には改善しているが、受け入れ可能な状態ではない。

確認済みの問題:

- `Setup Wizard` は日別 / 週別 / 月別の切替は戻ったが、**期間を 1 件しか選べない**
- reference app では「期間を 1 つ以上選択」「全選択」「解除」があり、比較前提の UX になっている
- Claude 報告では BQ contract に `dataset_id` があるが、Insight Studio 側コードでは 1 回も送っていない
- setup 完了時に保存した `queryTypes / period / granularity` は downstream 画面でほぼ使われていない
- `Settings` は一部保存 API があるが、画面内のかなりの領域が固定表示で、使い方が伝わらない
- ヘッダーのベルアイコンは未実装で、赤い点だけが常に出ている
- 左カラムは文字が小さく、幅固定で、調整もできない
- `npm run build` は通るが、`npm run lint` は失敗している

結論:

- いま必要なのは「追加のつぎはぎ」ではなく、**reference app と backend contract に合わせた全面是正**
- 特に `Setup Wizard` は「複数期間選択」と「downstream 反映」が入らない限り、実務で使える状態ではない

---

## 2. 今回の判断

この plan では、以下を前提に進める。

1. 現在の deploy は provisional とし、まだ acceptance しない
2. reference app との差分を DevTools で証明しながら直す
3. 見た目だけの UI は残さない
4. backend が支えていない機能は、無理に fake 実装せず、機能削除または明示的な未提供表示に変える
5. `Setup Wizard` の parity と downstream 配線を P0 扱いにする
6. 設定/通知/左カラムの UX 改善は P1 として同じ流れで片付ける

---

## 3. ゴール

### P0

- `Setup Wizard` が reference app 相当の複数期間選択 UX を持つ
- reference app と Insight Studio の BQ contract 差分が証跡付きで整理される
- `dataset_id` の必要性が Yes / No で確定する
- setup で選んだ内容が downstream に実際に反映される

### P1

- `Settings` が「何を設定できるのか」が明確になり、使える項目だけを見せる
- ベルアイコンが実際に使えるようになる、または根拠をもって削除/無効化される
- 左カラムの文字サイズが改善され、カラム幅を調整できる

### P2

- build が通る
- lint が通る
- deploy 後の live retest が完了する
- handoff に残課題が明確に残る

---

## 4. スコープ

### 対象

- `src/pages/SetupWizard.jsx`
- `src/api/adsInsights.js`
- `src/contexts/AdsSetupContext.jsx`
- `src/contexts/AuthContext.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/Settings.jsx`
- `src/components/Layout.jsx`
- `src/App.jsx`
- `vercel.json`
- `vite.config.js`
- deployed Insight Studio app
- reference app: `https://ads-insights-eight.vercel.app`

### スコープ外

- Market Lens 機能の追加改善
- compare / discovery / creative-review の新規要件
- plugin / skill の新規開発

---

## 5. 非交渉ルール

1. DevTools request / response を見ずに backend contract を決めつけない
2. reference app と比較せずに parity 達成を宣言しない
3. 見た目だけのボタン、バッジ、カード、トグルを放置しない
4. setup 完了状態だけ保存して、実際の分析に反映しない設計を放置しない
5. lint failure を残したまま完了扱いにしない

---

## 6. 現時点の主要 Findings

### F1. Wizard は単一期間しか選べない

現コード:

- `selectedPeriod` が単一値
- 期間カード click は `setSelectedPeriod(value)` のみ
- 全選択 / 解除 / 複数選択 count がない

これは reference app と明確に不一致。

### F2. `dataset_id` がコード上に存在しない

Claude 報告の contract:

- `GET /api/bq/periods`
  - `granularity`, `dataset_id`, `fresh`
- `POST /api/bq/generate_batch`
  - `query_types`, `dataset_id`, `period`

現コード:

- `granularity` は送る
- `dataset_id` は 1 回も送らない

このギャップは要証明。

### F3. downstream が setup 条件を使っていない

保存しているのは:

- `queryTypes`
- `period`
- `granularity`

しかし下流のページでは setup state を参照していない。

そのため、setup は gate と見た目だけで、分析条件としては死んでいる可能性が高い。

### F4. Settings / Bell / Sidebar に未完成領域が多い

- `Settings` は一部 API 保存だけ実装され、他は固定表示
- ベルは onClick なし
- 左カラムは固定幅で可読性調整不能

---

## 7. Workstream A: Evidence / Contract Audit

最優先は、reference app と Insight Studio の contract を揃えて理解すること。

### A-1. reference app 実機確認

対象:

- `https://ads-insights-eight.vercel.app`

やること:

1. Chrome DevTools を開く
2. `Disable cache` と `Preserve log` を有効化
3. BQ Wizard の Step 1 -> Step 2 -> Step 3 を実行
4. 以下を必ず捕捉する
   - `GET /api/bq/periods`
   - `POST /api/bq/generate` または `POST /api/bq/generate_batch`
5. 複数期間選択時の request shape を必ず記録する

確認項目:

- `granularity`
- `dataset_id`
- `fresh`
- `query_type` か `query_types` か
- `period` が string か array か
- 全選択 / 解除のときの挙動
- response body shape

### A-2. Insight Studio 実機確認

対象:

- deployed Insight Studio app

やること:

1. hard reload で最新 bundle を確認
2. 同じ操作を行い、network capture を取得
3. reference app と差分比較する

### A-3. backend identity の確定

確認すること:

- 両者の request destination が本当に同じ backend か
- 同じ auth 方式か
- 同じ OpenAPI / contract か
- default dataset による見かけの一致ではないか

成果物:

- request / response memo
- reference vs Insight Studio diff table
- `dataset_id` 要否の結論

---

## 8. Workstream B: Setup Wizard Parity Recovery

対象:

- `src/pages/SetupWizard.jsx`
- 必要なら `src/api/adsInsights.js`

### B-1. 複数期間選択の実装

やること:

1. `selectedPeriod` 単一 state をやめる
2. `selectedPeriods` を `Set` or ordered array で持つ
3. 期間カードは toggle 選択にする
4. 選択件数を UI に表示する
5. `全選択` / `解除` を reference app 相当で追加する
6. `次へ` の活性条件を「1件以上選択」に変更する

### B-2. granularity 切替の完成

やること:

1. `月別 / 週別 / 日別` を維持
2. 粒度変更時に period list を再取得
3. 粒度変更時の選択リセット仕様を reference app に合わせる
4. loading / empty / error の状態を粒度ごとに明確化

### B-3. generate endpoint の正規化

やること:

1. reference app が実際に叩いている endpoint を採用
2. `query_type` と `query_types` を推測で決めない
3. `period` が単一なのか配列なのかも request 証跡に従う
4. `dataset_id` が必要なら state / API client / request body に組み込む

### B-4. UX parity の補完

やること:

1. reference app と比較して不足 UI を埋める
2. `1件以上選択してください` のようなガイドを表示
3. compare/selection 意図が分かる文言に変更する

受け入れ条件:

- 2 件以上の期間を選択できる
- 全選択 / 解除が使える
- request shape が reference app と一致する

---

## 9. Workstream C: Setup State の downstream 配線

対象:

- `src/contexts/AdsSetupContext.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- 必要なら他 Ads pages

まず確定すべきこと:

- backend 側が generate 結果をトークン/セッションに保持しており、下流画面は別 API を叩けばよいのか
- それとも、下流画面ごとに `queryTypes / periods / granularity / dataset_id` を request に渡す必要があるのか

### 分岐 A: backend persists の場合

やること:

1. その事実を request / response で証明
2. `setupState` が gate 専用なのか、表示専用にも使うのかを整理
3. 下流画面に setup summary を表示して、何で分析しているかユーザーに見せる

### 分岐 B: client-driven の場合

やること:

1. `setupState` を各画面で参照
2. API request に setup 条件を反映
3. 選択期間・粒度・クエリタイプが各画面で見えるようにする

最低限やること:

- 現在の分析対象期間が各ページに表示される
- setup した条件と実際の API 呼び出しが一致する

---

## 10. Workstream D: Settings Page の実装整理

対象:

- `src/pages/Settings.jsx`
- `src/api/adsInsights.js`
- 必要なら backend contract

### D-1. 使い方が分かるようにする

ユーザーの疑問:

- この設定はどう使うのか
- 何が backend に保存されるのか

やること:

1. `設定可能項目` と `反映先` を画面上に明示
2. `保存` 後に何が変わるのか説明する
3. ログインしていない場合は保存不可理由を明示する

### D-2. fake 領域の扱いを是正する

現在の固定表示:

- プロフィール
- レポート履歴
- ストレージ使用状況
- BigQuery 連携設定
- 二要素認証

やること:

1. backend に real source があるなら API 結線する
2. real source がないなら以下のどちらかにする
   - UI から一旦削除
   - `準備中` と明示し、操作可能に見せない

### D-3. `/api/config` の責務を明確にする

やること:

1. 何を保存できる API なのかを contract で確認
2. 3 つの boolean だけなら、その範囲に Settings を絞る

---

## 11. Workstream E: 通知ベルの整理

対象:

- `src/components/Layout.jsx`
- 必要なら backend contract

現在:

- ベルに click handler なし
- unread dot が常時表示

やること:

1. 通知 endpoint / contract があるか確認
2. ある場合:
   - 通知 panel / drawer を実装
   - unread count / read state を実装
3. ない場合:
   - ベルと赤 dot を残さない
   - 代わりに tooltip 付きの無効状態か、機能削除にする

非交渉:

- 使えないのに使えそうに見せない

---

## 12. Workstream F: 左カラム可読性と幅調整

対象:

- `src/components/Layout.jsx`

やること:

1. ナビ文字サイズを一段上げる
   - 例: `text-sm` -> `text-[15px]` or `text-base`
2. 階層リンクの可読性を改善する
3. sidebar width を可変にする
4. drag handle を追加する
5. width を localStorage に保存する
6. min / max width を設ける
7. main content の `margin-left` を width に連動させる

モバイル/狭幅時:

- resize UX が無理なら collapse モードも検討する

---

## 13. Workstream G: 品質ゲート

やること:

1. `npm run build`
2. `npm run lint`
3. Wizard の local smoke test
4. deploy
5. live retest

lint で現在見えているもの:

- `Layout.jsx` unused var
- `Settings.jsx` unused var
- context files の fast refresh lint
- `AnalysisGraphs.jsx` の effect 内 setState

今回の完了条件:

- lint failure を 0 にする
- 少なくとも「今回触った範囲の問題」は全部潰す

---

## 14. Agent Team で進める場合の推奨分担

タスク量は大きいので、Claude 側で agent team が使えるなら分担推奨。

### Lead / Integrator

責務:

- 全体方針維持
- reference diff と実装結果の統合
- acceptance judgment

### Agent 1: Reference Contract Verifier

責務:

- `ads-insights-eight.vercel.app` の DevTools capture
- multi-select behavior
- `periods` / `generate` contract の記録
- `dataset_id` / `period` / `query_types` の形の確定

### Agent 2: Insight Studio Live Verifier

責務:

- deployed Insight Studio の live capture
- current mismatch の証拠取得
- backend identity の比較

### Agent 3: Wizard Parity Worker

責務:

- `SetupWizard.jsx` の multi-select 化
- granularity / selection UX
- generate request shape 修正

担当ファイル:

- `src/pages/SetupWizard.jsx`
- 必要なら `src/api/adsInsights.js`

### Agent 4: Downstream Wiring Worker

責務:

- setup state の利用箇所を配線
- pack / graphs / ai の request / summary / UI 修正

担当ファイル:

- `src/contexts/AdsSetupContext.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`

### Agent 5: Settings / Topbar / Sidebar Worker

責務:

- Settings を real scope に整理
- bell の実装 or 削除
- 左カラムの文字サイズ改善
- sidebar resizable 実装

担当ファイル:

- `src/pages/Settings.jsx`
- `src/components/Layout.jsx`

### Agent 6: QA / Release Worker

責務:

- lint/build
- regression check
- deploy readiness
- live retest

---

## 15. Skill を使う場合の推奨

Claude 環境で skill が使えるなら、以下に相当する skill を優先する。

### 1. Browser / DevTools Verification

用途:

- reference app の network capture
- deployed app の network capture
- backend identity 確認

### 2. Repo Search / Contract Audit

用途:

- `dataset_id`
- BQ endpoint shape
- setup state downstream usage
- fake UI の実装範囲確認

### 3. Frontend Integration

用途:

- multi-select wizard
- settings page simplification
- notification panel / removal
- resizable sidebar

### 4. Release Verification

用途:

- lint/build
- deploy
- post-deploy retest

---

## 16. 実装順

1. Agent 1 が reference app の contract と multi-select behavior を確定
2. Agent 2 が Insight Studio live behavior を capture
3. Lead が両者差分を確定し、`dataset_id` と generate shape を判断
4. Agent 3 が Wizard parity を修正
5. Agent 4 が downstream 配線を修正
6. Agent 5 が Settings / Bell / Sidebar を修正
7. Agent 6 が lint/build/regression/live retest を実施
8. Lead が final review と handoff を作成

---

## 17. 受け入れ条件

### 必須

- 期間を複数選択できる
- reference app と同じ generate request shape になる
- `dataset_id` 要否が証跡付きで説明される
- setup 条件が downstream に反映される
- Settings の fake 領域が整理される
- ベルが実装されるか、未提供として整理される
- 左カラムの文字が読みやすくなり、幅調整できる
- build と lint が通る

### 条件付き

- backend 側に未対応機能があるなら、その部分は明示的に de-scope し、見た目からも分かるようにする

### 不可

- 単一期間選択のまま parity 達成と言うこと
- downstream 未配線のまま setup 完了扱いにすること
- bell / settings / status card を fake のまま残すこと
- lint failure を残したまま終えること

---

## 18. Claude にそのまま渡す推奨プロンプト

```md
`plans/2026-03-26-session-handoff.md` と `plans/2026-03-26-setup-wizard-and-ads-ux-parity-recovery-plan.md` を読んで、続きから対応してください。

現在の deploy は acceptance しません。
最優先は Setup Wizard の parity 回復と、Ads UX 全体の fake 実装整理です。

やること:
1. reference app `ads-insights-eight.vercel.app` を Chrome DevTools で調査し、複数期間選択の request / response を記録
2. deployed Insight Studio を Chrome DevTools で調査し、現在の `bq/periods` / `generate` 挙動を記録
3. `dataset_id` の要否、`period` の shape、`query_type(s)` の shape を証跡付きで確定
4. `SetupWizard` を複数期間選択対応に直し、全選択 / 解除 / 選択件数表示を追加
5. setup 条件が `/ads/pack`, `/ads/graphs`, `/ads/ai` に反映されるよう配線
6. `Settings` を real scope に整理し、使い方が分かるようにする
7. ベルアイコンを実装するか、未対応なら fake で残さず整理する
8. 左カラムの文字サイズを上げ、幅調整を可能にする
9. lint / build / deploy / live retest まで行う

可能なら agent team で分担してください。
推奨ロール:
- reference contract verifier
- insight studio live verifier
- wizard parity worker
- downstream wiring worker
- settings/topbar/sidebar worker
- qa/release worker

skill が使える環境なら、browser/devtools verification、repo search/contract audit、frontend integration、release verification 系を優先してください。

特に必ず報告してください:
- reference app の `bq/periods` request URL / query string / response body
- reference app の generate request body
- Insight Studio の `bq/periods` request URL / query string / response body
- Insight Studio の generate request body
- `dataset_id` の要否
- `period` が単数か複数か
- downstream で setup 条件がどう使われるか
- `Settings` で何が本当に保存・反映されるか
- ベルの機能有無
- sidebar resize の実装内容

注意:
- 単一期間選択のまま parity 達成としないこと
- fake UI を残さないこと
- lint failure を残さないこと
- DevTools の証跡なしに contract を断定しないこと
```

---

## 19. 一言で言うと

次にやるべきことは、`Setup Wizard` の細部調整ではない。  
**reference app と本当に揃っているかを証明しながら、複数期間選択・downstream 反映・設定/通知/左カラム UX まで含めて Ads 体験全体を本物にすること** である。
