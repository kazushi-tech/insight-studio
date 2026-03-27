# Insight Studio — Essential Pack Live Contract Recovery Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**対象画面:** `/ads/pack`  
**目的:** 本番 `Essential Pack` が依然として空表示のままである問題について、推測ではなく **live response / backend contract / reference app** を根拠に真因を確定し、正しい表示経路へ修復する

---

## 1. 現在の事実

2026-03-26 19:22 JST 時点の本番スクリーンショットでは、`/ads/pack` は依然として以下の状態。

- 上部に黄色バナー
  - `backend から構造化セクションも本文も返っていません。固定ダミーは表示せず、この状態をそのまま示しています。`
- メイン領域にレポート本文が出ていない
- `backend response preview` のような追加デバッグ表示も出ていない

このことから、少なくとも以下のどれかが起きている。

1. 最新の修正が本番 bundle に載っていない
2. `/ads/pack` の現在の request / response contract の見立てが外れている
3. `generate_insights` は本当に本文を返していない
4. そもそも `Essential Pack` が参照すべきデータ源は `generate_insights` ではなく、Wizard 側の `bqGenerateBatch` 結果である

---

## 2. この plan の最重要判断

今回やるべきことは、`EssentialPack.jsx` を場当たり的にいじり続けることではない。

**まず以下を証明することが必要。**

1. 本番でどの bundle が読み込まれているか
2. `/api/ads/generate_insights` の request body / response body は実際に何か
3. Wizard の `/api/ads/bq/generate_batch` は何を返しているか
4. reference app の `/ads/pack` 相当はどのレスポンスを画面に使っているか
5. backend repo `ads-insights` の一次実装はどの flow を意図しているか

その上で、分岐は 2 つしかない。

### 分岐 A

`/ads/pack` は `generate_insights` の response を表示するのが正しい。

この場合にやること:

- `generate_insights` の真 response shape に合わせて frontend を直す
- `report_md` / `markdown` / nested payload 等を正しく拾う
- 必要なら `dataset_id` / `project_id` / `period` を request に追加する

### 分岐 B

`/ads/pack` は Wizard の `bqGenerateBatch` が返すレポートを表示するのが正しい。

この場合にやること:

- Wizard 結果を `AdsSetupContext` に保持する
- `EssentialPack` は `generate_insights` ではなく Wizard 結果を primary source にする
- リロード時のみ再取得する

**この分岐は、証跡を見てから決める。推測で選ばない。**

---

## 3. 現時点で疑うべき点

### H1. 本番が最新コードではない

理由:

- スクリーンショット上の UI は、前回と同じ empty 表示に見える
- 追加したはずの response preview 系表示が見えていない

### H2. `generate_insights` の response shape が現フロント想定と違う

理由:

- これまでの経緯で、`sections[*].metrics / devices / table` は frontend 側の期待に寄っていた
- `report_md`, `markdownReport`, `response.data.*` などの別 shape の可能性が高い

### H3. `dataset_id` を downstream に渡していないため、generic / empty な応答になっている

理由:

- repo 内の複数 plan で `dataset_id` 要否が未確定のまま残っている
- BQ endpoint 群では `dataset_id` が明示的に使われていた
- downstream でも必要な可能性が高い

### H4. `Essential Pack` の正しい元データは Wizard output であり、`generate_insights` ではない

理由:

- 別プラン `rustling-dancing-frog.md` ではこの仮説が提示されている
- ただし現時点では repo 内に一次根拠がない

---

## 4. 絶対条件

1. DevTools で live request / response を見ること
2. `ads-insights` repo の file path / line number を根拠にすること
3. reference app の network を比較すること
4. fake KPI / fake section を戻さないこと
5. 「表示されたからOK」ではなく、「なぜ表示されるようになったか」を contract ベースで説明すること

---

## 5. Workstream A: Deployed Bundle Verification

### 目的

本番画面が最新コードかどうかを先に潰す。

### やること

1. 本番 `/ads/pack` を開く
2. Chrome DevTools を開く
3. `Disable cache` を ON
4. hard reload
5. 読み込まれた JS bundle 名と hash を控える
6. local build と現在の deploy が一致しているか確認する

### 必ず記録すること

- URL
- bundle filename
- hard reload 後も UI が変わらないか
- old bundle を見ている可能性の有無

### 受け入れ条件

- 「本番が最新 bundle かどうか」が Yes / No で言える

---

## 6. Workstream B: Live Network Capture

### B-1. `/api/ads/generate_insights`

対象:

- `/ads/pack` 画面表示時
- `AI考察を再生成` 押下時

必ず取得するもの:

- request URL
- request body
- request headers
- response status
- response headers
- response body

特に見るべき点:

- `dataset_id` が入っているか
- `query_types`
- `periods`
- `granularity`
- response が top-level か nested か
- `report_md`
- `markdownReport`
- `summary`
- `point_pack`
- `sections`
- `text`
- `response`
- `data`
- `result`

### B-2. `/api/ads/bq/generate_batch`

対象:

- Wizard Step 2 -> Step 3

必ず取得するもの:

- request body
- response body
- period ごとの response shape

特に見るべき点:

- `markdownReport`
- `chartData`
- `summary`
- `point_pack`
- `ok`
- 期間単位でレポート本文が返っているか

### B-3. 判定

以下を Yes / No で結論づけること。

- `generate_insights` は表示可能な本文を返しているか
- `bqGenerateBatch` は表示可能な本文を返しているか
- `/ads/pack` はどちらを使うべきか

---

## 7. Workstream C: Repo-Grounded Contract Audit

### 対象 repo

- `https://github.com/kazushi-tech/ads-insights`

### 必ず見る対象

- `generate_insights` route
- BQ `generate_batch` route
- reference frontend の `/ads/pack` 相当 component
- Wizard component
- report render component

### 必ず報告すること

- file path
- line number
- そのコードが返す / 期待する shape

### ほしい結論

1. `Essential Pack` の正規 data source は何か
   - `generate_insights`
   - `bqGenerateBatch`
   - その他
2. `markdownReport` は実際に存在するか
3. `sections` は実際に存在するか
4. `dataset_id` は downstream でも必要か
5. reference app は Wizard の結果を保持して pack に渡しているか

---

## 8. Workstream D: Frontend Fix Decision Tree

### D-1. `generate_insights` が正規 source だった場合

修正対象:

- `src/api/adsInsights.js`
- `src/pages/EssentialPack.jsx`
- 必要なら `src/utils/adsResponse.js`

やること:

1. 真 response shape に合わせて正文取得ロジックを修正
2. `report_md` / `markdown` / nested payload を拾う
3. 本文が markdown なら markdown renderer で描画
4. `dataset_id` が必要なら request に必ず含める
5. `sections` が本当に無いなら、架空セクション UI は廃止して markdown / report display に寄せる

### D-2. `bqGenerateBatch` が正規 source だった場合

修正対象:

- `src/contexts/AdsSetupContext.jsx`
- `src/pages/SetupWizard.jsx`
- `src/pages/EssentialPack.jsx`
- 必要なら `src/components/MarkdownRenderer.jsx`

やること:

1. Wizard response を in-memory で保持
2. `completeSetup(metadata, reportData)` の形に拡張
3. `EssentialPack` は `reportData` を primary source にする
4. リロード時は `bqGenerateBatch` 再取得
5. 複数期間なら period switcher を用意

### D-3. 両方が使われている場合

やること:

- reference app と同じ優先順位を採用
- たとえば
  - primary: Wizard output
  - fallback: `generate_insights`
  - のように明示設計する

---

## 9. スコープ外

今回は以下を主目的にしない。

- `AnalysisGraphs.jsx` の本格 chart 化
- `AiExplorer.jsx` の改善
- export / share ボタンの実装
- Settings / sidebar / bell の追加改善

ただし、`/ads/pack` 修復のために最低限触る必要がある shared code は対象に含めてよい。

---

## 10. 変更候補ファイル

- `src/api/adsInsights.js`
- `src/pages/EssentialPack.jsx`
- `src/pages/SetupWizard.jsx`
- `src/contexts/AdsSetupContext.jsx`
- `src/utils/adsResponse.js`
- `src/components/MarkdownRenderer.jsx`

---

## 11. 検証

### local

- `npm run lint`
- `npm run build`

### live

1. `/ads/wizard`
2. Step 2 -> Step 3 完了
3. `/ads/pack` 遷移
4. 本文が表示される
5. 複数期間なら切替できる
6. hard reload 後も contract に従って再表示される

### 必須証跡

- `/api/ads/generate_insights` request / response
- `/api/ads/bq/generate_batch` request / response
- reference app 側の対応 request / response

---

## 12. 完了条件

以下が全部揃って初めて完了。

- `/ads/pack` が real backend data を表示する
- それが `generate_insights` 由来か `bqGenerateBatch` 由来か説明できる
- file/line 根拠がある
- fake section を戻していない
- build / lint が通る
- live retest が完了する

---

## 13. 禁止事項

- `sections[]` がある前提で作業を進めること
- `markdownReport` がある前提で作業を進めること
- DevTools request を見ずに flow を決めること
- backend repo を見ずに reference app の仕様を断定すること
- placeholder UI を復活させること

---

## 14. Claude にそのまま渡す推奨プロンプト

```md
`plans/2026-03-26-essential-pack-live-contract-recovery-plan.md` を読んで、続きから対応してください。

最優先は `/ads/pack` の空表示修復です。
ただし推測で直すのではなく、live response と `ads-insights` repo の一次情報を根拠に flow を確定してください。

現状:
- 2026-03-26 19:22 JST 時点の本番 `/ads/pack` は、依然として
  - 「backend から構造化セクションも本文も返っていません」
  と表示され、本文が出ていません
- つまり previous fixes が deploy されていないか、contract の見立てが外れています

やること:
1. 本番 `/ads/pack` の bundle hash を確認し、最新 deploy かどうかを確定
2. DevTools で `/api/ads/generate_insights` の request / response を捕捉
3. DevTools で Wizard の `/api/ads/bq/generate_batch` の request / response を捕捉
4. `https://github.com/kazushi-tech/ads-insights` を読み、`generate_insights` / `generate_batch` / reference pack UI の file path と line number を示す
5. `/ads/pack` の正規 data source が
   - `generate_insights`
   - `bqGenerateBatch`
   - 両方
   のどれかを根拠付きで確定
6. その正規 flow に合わせて `EssentialPack` を修正
7. fake UI を戻さず、live retest まで行う

必ず報告すること:
- 本番 bundle が最新かどうか
- `generate_insights` の response body
- `generate_batch` の response body
- `dataset_id` が downstream で必要か
- `sections` が本当に存在するか
- `markdownReport` が本当に存在するか
- `/ads/pack` は最終的にどの source を使うべきか
- 修正した file path

禁止:
- DevTools request を見ずに flow を決めること
- repo を見ずに reference app の shape を断定すること
- placeholder UI を復活させること
```

---

## 15. 一言で言うと

今回の仕事は `EssentialPack.jsx` の if 文をいじることではない。  
**`/ads/pack` が本来どの backend response を表示すべき画面なのかを live と repo の両方で確定し、その flow に合わせて画面を作り直すこと** が本題である。
