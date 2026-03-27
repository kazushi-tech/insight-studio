# ナビ修正・セットアップロック・ダッシュボード実データ化プラン

## 目的

以下をまとめて解消する。

1. `クリエイティブ診断` に残っている `停止中` 表示を除去する
2. `広告考察` は `セットアップ` 完了前に下位項目を触れないことを UI / route の両方で明確にする
3. `ダッシュボード` に残っている demo / static 表示を排除し、live data のみを根拠に表示する
4. 将来的に「昨日」「今月」など GA ライクな見やすいダッシュボードへ拡張できる土台を作る

## 現状認識

### 1. `クリエイティブ診断` の停止中表示

- `src/components/Layout.jsx` の sidebar 定義に `badge: '停止中'` が残っている
- 本体ページ `src/pages/CreativeReview.jsx` はすでに workflow 復旧済み
- つまり UI 表示だけが古い

### 2. `広告考察` のロック

- route 側では `src/App.jsx` の `SetupGuard` により `/ads/pack`, `/ads/graphs`, `/ads/ai` は setup 未完了時に wizard へリダイレクトされる
- sidebar 側でも `src/components/Layout.jsx` の `SETUP_GATED_PATHS` で見た目上の disable はある
- ただし「何が setup 完了条件なのか」が UI 上で分かりにくい
- `src/contexts/AdsSetupContext.jsx` の `isSetupComplete` は persisted `setupState` の存在だけで判定しており、ユーザー視点では「今のセッションでまだ何も出していないのに unlock されて見える」違和感が起きやすい

### 3. `ダッシュボード` の truthfulness

- `src/pages/Dashboard.jsx` の上部 3 カードは `STAT_CARDS` の hardcoded 値
- `今週のトレンドキーワード` も `TREND_KEYWORDS` の hardcoded 値
- live なのは `getScans()` を使った「最近の分析結果」テーブルだけ
- したがって、現 dashboard は一部 live / 一部 demo の混在状態

### 4. 既存 Claude plan の評価

- `plans/mellow-kindling-lighthouse.md` は `設定ページ実用化リデザイン` 用の plan
- 今回の `creative-review badge`, `ads setup gating`, `dashboard truthfulness` には直接効かない
- そのため今回の実装着手 plan としては不足

## 進め方

### Workstream A: ナビと setup 状態の即時修正

対象:

- `src/components/Layout.jsx`
- 必要なら `src/App.jsx`

実施内容:

1. `クリエイティブ診断` の `停止中` badge を削除
2. `広告考察` の gated 項目に `要設定` / `要セットアップ` を明示
3. sidebar の接続 status に `考察セットアップ: 完了 / 未完了` を追加
4. `SetupGuard` が route でも確実に効いていることを確認
5. wizard 未完了時に `/ads/pack`, `/ads/graphs`, `/ads/ai` へ直接遷移しても戻されることを smoke test

完了条件:

- sidebar 上で `CreativeReview` は通常表示
- setup 未完了時、`要点パック / グラフ / AI考察` は見た目でも lock
- direct URL access でも unlock されない

### Workstream B: Dashboard truthfulness v1

対象:

- `src/pages/Dashboard.jsx`
- `src/api/marketLens.js`
- `src/contexts/AdsSetupContext.jsx`
- `src/utils/adsReports.js`

方針:

- 「live source がない値」は表示しない
- 「推定値」や「仮値」は dashboard から撤去する
- first release では GA 完全再現ではなく、truthful な live summary に寄せる

実施内容:

1. hardcoded `STAT_CARDS` を廃止
2. live source から算出できるカードへ置換
   - `比較分析履歴数` ← `getScans()`
   - `最新比較分析日時` ← `history[0].created_at`
   - `設定済みクエリ数 / 期間数 / 利用可能グラフ数` ← `setupState` / `reportBundle`
3. `TREND_KEYWORDS` hardcoded block を撤去
4. 代わりに live な `現在のセットアップ` or `最新レポート状況` card を表示
5. live data 未取得時は empty state か skeleton を出す
6. misleading な `最新CPA ¥2,450` のような静的指標は削除

完了条件:

- dashboard 上に hardcoded metric が残らない
- 画面上の主要数値はすべて local context / API 由来
- 空データ時も自然な empty state になる

### Workstream C: Dashboard truthfulness v2 (GA-like 改善)

対象:

- `src/pages/Dashboard.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/utils/adsReports.js`
- 必要なら `src/components/charts/*` 新設

方針:

- `ads-insights` の `bq_generate_batch` 結果 (`reportBundle.chartGroups`) を dashboard 向けに再利用する
- 「昨日」「今月」の切替と、カード + compact chart を持つ overview を作る

実施内容:

1. timeframe selector を追加
   - `昨日`
   - `直近7日`
   - `今月`
2. `chartGroups` から dashboard 向け summary を抽出
3. GA 風の compact charts を 2-4 枚表示
4. card title / subtitle / unit を live chart の意味に合わせて動的化
5. dashboard から `グラフ` ページへ drill-down できる導線を追加

注意:

- chart group title / dataset label の命名は backend 依存なので、title ベースの heuristic を先に整理する
- もし dashboard 専用 summary API が必要なら別 workstream として切る

完了条件:

- dashboard を見れば「昨日」「今月」の主要変化が分かる
- static の装飾カードではなく、実データ overview になっている

### Workstream D: setup gating の hardening

対象:

- `src/contexts/AdsSetupContext.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`

実施内容:

1. `setupState` の persisted 判定だけで unlock してよいか見直す
2. `reportBundle` が未ロードでも page mount 時に再生成できる現在仕様を維持するか評価
3. 再生成失敗時は broken setup として wizard へ戻す導線を検討
4. sidebar status に `最終セットアップ日時` を出す案も検討

判断基準:

- 単に「今セッションで未生成」なだけなら unlock のままでよい
- ただし persisted state が壊れている場合は unlock しない

## 実装順

1. Workstream A
2. Workstream B
3. Workstream D
4. Workstream C

理由:

- A は低コストで即効性がある
- B は「今 dashboard が demo では？」という信頼問題を先に潰す
- D は gating の判定を壊すと利用導線に影響するので、truthfulness 修正後に行う
- C は一番工数が大きい

## Agent Team 案

### Agent 1: Nav / Gating Worker

責務:

- `src/components/Layout.jsx`
- `src/App.jsx`
- `src/contexts/AdsSetupContext.jsx` の gating 周辺

成果物:

- 停止中 badge 除去
- setup lock UX
- route guard hardening

### Agent 2: Dashboard Truthfulness Worker

責務:

- `src/pages/Dashboard.jsx`
- `src/utils/adsReports.js`

成果物:

- hardcoded metrics の撤去
- live-driven cards / empty states

### Agent 3: Dashboard UX / Chart Worker

責務:

- dashboard compact chart UI
- timeframe switcher
- drill-down 導線

成果物:

- GA-like overview v2

## 検証項目

1. `Creative Review` sidebar に `停止中` が残っていない
2. setup 未完了時:
   - `要点パック` は lock 表示
   - `グラフ` は lock 表示
   - `AI考察` は lock 表示
   - 直接 URL 入力でも wizard に戻る
3. setup 完了後:
   - 上記 3 ページが unlock される
   - `EssentialPack / Graphs / AiExplorer` が report bundle を再生成できる
4. dashboard:
   - hardcoded `1,240`, `45`, `¥2,450` が消えている
   - hardcoded trend keywords が消えている
   - live data がない場合は empty state になる
5. `npm run lint`
6. `npm run build`

## Claude への依頼文

```
Dashboard の demo/static 状態を解消し、ナビと setup gating を実態に合わせて修正してください。

前提:
- `CreativeReview` は復旧済みなので sidebar の `停止中` badge は削除
- `広告考察` は `セットアップ` 完了前に `要点パック / グラフ / AI考察` を触れないようにする
- route guard だけでなく、sidebar 上でも `要設定` が分かる UI にする
- dashboard の hardcoded metric (`1,240`, `45`, `¥2,450`) と hardcoded trend keywords は撤去
- dashboard は live data のみを表示し、live source がない値は表示しない

主な対象:
- `src/components/Layout.jsx`
- `src/App.jsx`
- `src/contexts/AdsSetupContext.jsx`
- `src/pages/Dashboard.jsx`
- `src/utils/adsReports.js`

実装順:
1. nav / gating の即時修正
2. dashboard truthfulness v1
3. setup gating hardening
4. 余力があれば GA-like compact chart dashboard v2

必須検証:
- `npm run lint`
- `npm run build`
- setup 未完了時の sidebar / direct URL guard
- dashboard から hardcoded 値が消えていること
```
