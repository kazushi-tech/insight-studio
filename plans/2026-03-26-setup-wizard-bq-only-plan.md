# Insight Studio — Setup Wizard BigQuery-Only Realignment Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**ブランチ:** `master`  
**現在の HEAD:** `85109464aab435e158ccb6b8d4ad1b8d03bacddc`  
**目的:** `Setup Wizard` を一旦 **BigQuery 専用** に整理し、`月別 / 週別 / 日別` の粒度選択を復旧したうえで、Insight Studio が本当に考察スタジオ backend と連携しているかを根拠付きで確定する

---

## 1. この plan が必要な理由

現状の `Setup Wizard` は「期間が出るようになった」一方で、重要なズレが残っている。

確認済みの問題:

- `EXCEL / BIGQUERY / 統合` タブがあるが、いま必要なのは BigQuery 連携のみ
- `統合` は見た目だけで、実装上は Excel 側に落ちる経路になっている
- `BIGQUERY` でも `granularity` が `monthly` 固定で、`週別 / 日別` が選べない
- 参考画面の考察スタジオ本体では `月別 / 週別 / 日別` が選べる
- さらに、Insight Studio 側が本当に「あなたの考察スタジオ」と同じ backend / contract に乗っているかが未証明

結論:

- まず Wizard を **BigQuery-only** に絞る
- そのうえで **粒度選択を本来の形で戻す**
- さらに **実機の request / response で backend identity を証明する**

この順番で進めるのが最も安全。

---

## 2. 今回の意思決定

この plan では、以下を前提に進める。

1. `統合` タブは一旦削除してよい
2. `EXCEL` タブも一旦削除してよい
3. Wizard は当面 `BIGQUERY` 専用フローとして整理する
4. 復活可能性があるため、Excel 対応は git 履歴に残す前提で無理に壊さず、UI と分岐から外す
5. 「連携できている」と判断してよいのは、画面見た目ではなく **DevTools request / response と contract 一致** が確認できた後だけ

---

## 3. ゴール

### P0

- `Setup Wizard` が BigQuery 専用 UI に整理される
- `月別 / 週別 / 日別` の粒度選択が復旧する
- Insight Studio が叩いている backend と、考察スタジオ本体の backend / contract が一致しているか Yes / No で言える

### P1

- `/api/ads/bq/periods` と `/api/ads/bq/generate` の request / response が根拠付きで記録される
- `query_types` / `granularity` / `period` の実送信形式が確認される
- setup 完了後に `/ads/pack`, `/ads/graphs`, `/ads/ai` に入れる

### P2

- build が通る
- 本番 deploy 後に live retest が完了する
- 必要なら Excel / 統合の将来復活に向けた注意点が handoff に残る

---

## 4. スコープ

### 対象

- `src/pages/SetupWizard.jsx`
- `src/api/adsInsights.js`
- 必要なら `src/contexts/AuthContext.jsx`
- 必要なら `src/contexts/AdsSetupContext.jsx`
- 必要なら `src/components/Layout.jsx`
- `vercel.json`
- `vite.config.js`
- deployed Insight Studio app
- reference app: `https://ads-insights-eight.vercel.app`

### スコープ外

- Market Lens
- `Compare` / `Discovery` / `CreativeReview`
- Excel 実装の完成
- 統合モードの実装

---

## 5. 最優先で確認すること

## 5.1 本当にどの backend に繋いでいるか確認する

現コード上の Ads proxy は以下。

- `vercel.json`
  - `/api/ads/:path*` -> `https://ads-insights-9q5s.onrender.com/api/:path*`
- `vite.config.js`
  - 同じく `https://ads-insights-9q5s.onrender.com`

ここで確認すべきこと:

1. reference app `ads-insights-eight.vercel.app` が実際にはどこへ request を飛ばしているか
2. Insight Studio の proxy 先と一致しているか
3. 一致しないなら、いまの Insight Studio は「考察スタジオに似た何か」であって、同一 backend 連携とは言えない

必ず記録する内容:

- request URL
- initiator
- response status
- response body
- response headers
- `Authorization` header の有無

---

## 5.2 reference app 側で BQ Wizard の contract を実機確認する

対象:

- `https://ads-insights-eight.vercel.app`

やること:

1. Chrome DevTools を開く
2. `Disable cache` + `Preserve log` を有効化
3. BQ Wizard で `月別 / 週別 / 日別` を切り替える
4. それぞれで期間取得 request を捕捉する
5. 1 期間選んで generate 系 request も捕捉する

必ず見る点:

- endpoint path
- query string
- `granularity` の値
- response body shape
- `period_tag` / `period_type` / `period` 等の key
- generate 時の request body
- `query_types` の形式

重要:

- ここで reference app の contract を先に固定しないと、Insight Studio 側の修正が「似せたつもり」で終わる

---

## 5.3 Insight Studio 側で同じ contract を使えているか確認する

対象:

- deployed Insight Studio app

やること:

1. 最新 deploy を hard reload で確認
2. `/ads/wizard` を開く
3. query type を選んで Step 1 -> Step 2 の request を捕捉する
4. period を選んで Step 2 -> Step 3 の request を捕捉する

比較観点:

- path が一致しているか
- `granularity` が一致しているか
- `query_types` が一致しているか
- `period` / `period_tag` の形式が一致しているか
- auth の付き方が一致しているか
- response schema が一致しているか

---

## 6. Root Cause 仮説

現時点で強い仮説は以下。

### 仮説 A

`SetupWizard.jsx` が `bqPeriods({ granularity: 'monthly' })` を直書きしており、単に UI と state を削ってしまったため、週別 / 日別が消えた

### 仮説 B

Insight Studio は BigQuery backend には繋がっているが、reference app の frontend contract を十分に再現していない

### 仮説 C

proxy 先 `ads-insights-9q5s.onrender.com` 自体が、reference app と同じ backend ではない可能性がある

### 仮説 D

期間取得は通るが generate 側の body が reference app とズレている可能性がある

---

## 7. Workstream A: BigQuery-Only への整理

対象:

- `src/pages/SetupWizard.jsx`
- 必要なら `src/api/adsInsights.js`

やること:

1. `EXCEL` タブを削除
2. `統合` タブを削除
3. Wizard header を BigQuery 前提の文言に整理
4. `dataMode` 分岐を削除
5. `listPeriods`, `loadData`, `getFolders` など BigQuery-only で使わない経路を Wizard から外す

注意:

- Excel API クライアント自体を即削除するかは慎重に判断してよい
- ただし Wizard 上で「使えそうに見える未完成モード」は残さない

受け入れ条件:

- ユーザーが BigQuery 以外を選べない
- 実装上も BigQuery 以外の分岐が Wizard 内に残らない

---

## 8. Workstream B: 粒度選択の復旧

対象:

- `src/pages/SetupWizard.jsx`
- 必要なら `src/api/adsInsights.js`

やること:

1. `granularity` state を追加
   - `monthly`
   - `weekly`
   - `daily`
2. Step 2 に reference app と同等の粒度切替 UI を戻す
3. 粒度変更時に `bqPeriods({ granularity })` を再取得する
4. 選択中 period を粒度変更時に安全にリセットする
5. 期間カードの label / value を reference app の schema に合わせる

注意:

- 推測で `period_tag` 前提に固定しすぎない
- 実レスポンスで確認した key を優先する

受け入れ条件:

- 月別 / 週別 / 日別の 3 モードが UI 上で選べる
- それぞれで期間一覧が変わる
- 期間選択後に次へ進める

---

## 9. Workstream C: backend identity / contract の証明

この作業は「直す」より先に重要。

やること:

1. reference app の network capture を記録
2. Insight Studio の network capture を記録
3. 両者を並べて差分を書く
4. 以下を Yes / No で結論づける

- 同じ backend に繋いでいるか
- 同じ endpoint contract を使っているか
- 同じ auth 方式か
- 同じ granularity contract か

もし No が出た場合:

- `vercel.json`
- `vite.config.js`
- 必要なら frontend payload shape

を修正対象として明示する

---

## 10. Workstream D: Regression Check

修正後は最低限以下を確認する。

1. `新しいセットアップ` で state が初期化される
2. logout で setup state が消える
3. setup 完了前は `/ads/pack`, `/ads/graphs`, `/ads/ai` に入れない
4. setup 完了後は入れる
5. reload 後も setup 完了状態が維持される
6. 粒度変更後に別の期間を選んでも壊れない

---

## 11. Agent Team で進める場合の推奨分担

タスク量は十分大きいので、Claude 側で agent team が使えるなら分担推奨。

### Lead / Integrator

責務:

- 全体方針の維持
- reference app と Insight Studio の差分統合
- fix 方針決定
- 最終レビュー

### Agent 1: Reference App Verifier

責務:

- `ads-insights-eight.vercel.app` を DevTools で調査
- BQ Wizard の `periods` / `generate` contract を記録
- `月別 / 週別 / 日別` の差分を整理

成果物:

- reference contract memo

### Agent 2: Insight Studio Verifier

責務:

- deployed Insight Studio の network capture
- bundle hash 確認
- `/api/ads/bq/periods`
- `/api/ads/bq/generate`
- auth header の有無

成果物:

- current live behavior memo

### Agent 3: Wizard Simplification Worker

責務:

- `SetupWizard.jsx` を BigQuery-only に整理
- `EXCEL` / `統合` UI の削除
- `granularity` UI 復旧

担当ファイル:

- `src/pages/SetupWizard.jsx`

### Agent 4: Contract / Proxy Worker

責務:

- `adsInsights.js`
- `vercel.json`
- `vite.config.js`

を見直し、reference app と一致するように調整

担当ファイル:

- `src/api/adsInsights.js`
- `vercel.json`
- `vite.config.js`
- 必要なら `src/contexts/AuthContext.jsx`

### Agent 5: Regression / Release Worker

責務:

- guard / reset / persistence 確認
- `npm run build`
- deploy readiness
- live retest

担当ファイル:

- `src/App.jsx`
- `src/components/Layout.jsx`
- `src/contexts/AdsSetupContext.jsx`

---

## 12. Skill を使う場合の推奨

Claude 環境で skill が使えるなら、以下に相当する skill を優先する。

### 1. Browser / DevTools Verification

用途:

- reference app の network capture
- deployed app の network capture
- bundle hash / cache bypass 確認

### 2. Repo Search / Contract Audit

用途:

- proxy 設定確認
- Ads API client 確認
- Wizard state / payload 確認

### 3. Frontend Integration

用途:

- BigQuery-only UI への整理
- granularity selector 復旧
- response parsing の整合

### 4. Release Verification

用途:

- build
- deploy readiness
- post-deploy retest

---

## 13. 実装順

1. Agent 1 が reference app の contract を DevTools で確定
2. Agent 2 が Insight Studio live behavior を DevTools で確定
3. Lead が両者の差分から「backend identity」と「contract 差分」を確定
4. Agent 3 が Wizard を BigQuery-only に整理しつつ granularity UI を復旧
5. Agent 4 が API client / proxy / auth のズレを修正
6. Agent 5 が regression check と build を実施
7. 最後に live retest して、reference app と期待挙動が揃ったことを確認

この順番にする理由:

- まず reference contract を固定しないと「似た実装」しか作れない
- ただし `EXCEL / 統合` の撤去と BigQuery-only 化は、reference result を待たず先に進めやすい

---

## 14. 受け入れ条件

### 必須

- Wizard が BigQuery-only UI になる
- `月別 / 週別 / 日別` が選べる
- `GET /api/ads/bq/periods` の request / response が 3 粒度分記録される
- `POST /api/ads/bq/generate` の request body が記録される
- Insight Studio が reference app と同じ backend / contract を使っているかが Yes / No で報告される
- setup 完了後に gated routes に入れる
- build が通る

### 条件付き

- backend が本当に別物なら、その差分と修正方針が明記される
- Excel 復活を将来やる場合の戻し方が handoff に残る

### 不可

- `EXCEL` / `統合` を残したまま BigQuery-only と称すること
- monthly 固定のまま「BQ 連携は完了」と判断すること
- reference app と比較せずに「考察スタジオと繋がっている」と断定すること

---

## 15. Claude にそのまま渡す推奨プロンプト

```md
`plans/2026-03-26-session-handoff.md` と `plans/2026-03-26-setup-wizard-bq-only-plan.md` を読んで、続きから対応してください。

最優先は Setup Wizard の BigQuery-only 再整理です。
EXCEL と 統合 は一旦削除して構いません。

やること:
1. reference app `ads-insights-eight.vercel.app` を Chrome DevTools で確認し、BQ Wizard の contract を確定
2. Insight Studio の deployed app を Chrome DevTools で確認し、現在の `bq/periods` / `bq/generate` request を捕捉
3. 両者を比較して、本当に同じ backend / contract に繋いでいるかを Yes / No で報告
4. `SetupWizard` を BigQuery-only に整理し、EXCEL / 統合タブを削除
5. `月別 / 週別 / 日別` の粒度選択を復旧
6. setup 完了後の guard / reset / persistence を確認
7. build / redeploy / live retest まで行う

可能なら agent team で分担してください。
推奨ロール:
- reference app verifier
- insight studio verifier
- wizard simplification worker
- contract / proxy worker
- regression / release worker

skill が使える環境なら、browser/devtools verification、repo search/contract audit、frontend integration、release verification 系を優先してください。

特に必ず報告してください:
- reference app の `bq/periods` request URL / query string / response body
- Insight Studio の `bq/periods` request URL / query string / response body
- `bq/generate` の request body
- `granularity` の実送信形式
- `query_types` の実送信形式
- auth header の有無
- proxy 先 backend が同じかどうか

注意:
- monthly 固定のまま完了扱いにしないこと
- EXCEL / 統合を残したまま BigQuery-only と言わないこと
- reference app と比較せずに「考察スタジオ連携できた」と断定しないこと
```

---

## 16. 一言で言うと

次の本丸は「期間が出るようになったか」ではない。  
`Setup Wizard` を **BigQuery-only に整理し直し、週別 / 日別を戻し、本当に考察スタジオ backend と繋がっていることを実機で証明する** フェーズである。
