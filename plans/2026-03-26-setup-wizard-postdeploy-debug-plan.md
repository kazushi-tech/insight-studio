# Insight Studio — Setup Wizard Post-Deploy Debug Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**目的:** 本番デプロイ後の `Setup Wizard` を Chrome DevTools で実機確認し、`期間選択` 不具合の原因を frontend / backend / deploy mismatch に切り分けて復旧する  
**前提:** `Market Lens` 側の follow-up は別トラックで進行済み。この plan は `Setup Wizard` と Ads API の live verification に集中する

---

## 1. この plan が必要な理由

現在の重要な未解決事項は `Setup Wizard` である。

確認できている事実:

- 現在のコードでは、`periods.length === 0` の場合は Step 2 に進まず error を表示する
- しかし添付スクリーンショットでは Step 2 に進んだ状態で `利用可能な期間がありません。` と出ている
- これは以下のいずれかを示唆する
  - 最新デプロイを見ていない
  - 古い bundle が表示されている
  - 実際のデプロイ内容がローカルとずれている
  - もしくは別条件で Step 2 に入っている

また、コード上にもまだリスクがある。

### コード上の重要リスク

1. `list_periods` と `load` で query_types の送信形式が揃っていない可能性
   - `list_periods` は array / comma string の両方を試す
   - しかし成功した実際の形式は保持していない
   - `loadData()` には array しか渡さない経路が残っている

2. `getFolders()` の結果を取得しているが使っていない
   - backend 契約上、案件や folder 情報が必要なら period が空でも不思議ではない

3. auth や request payload の実態がローカルコードレビューだけでは確定しない
   - `401`
   - `403`
   - `200 + []`
   - `200 + unexpected schema`
   - を実機で見分ける必要がある

結論:

- 次はコードレビューではなく、**最新デプロイに対する Chrome DevTools 実機確認** が必要
- しかも確認対象は単なる画面目視ではなく、`Network` 上の request / response と bundle version を含む

---

## 2. この plan のゴール

### P0

- 最新デプロイを本当に見ているか確定する
- `/ads/wizard` の `Step 1 -> Step 2` で飛んでいる `/api/ads/list_periods` の request / response を確定する
- `期間が出ない理由` を以下のどれかに切り分ける
  - deploy mismatch
  - auth 問題
  - query_types format 問題
  - folder / case など不足パラメータ
  - response shape 取りこぼし

### P1

- 必要なら `SetupWizard.jsx` / `adsInsights.js` を修正する
- `Step 2 -> Step 3` の `/api/ads/load` まで実機で確認する

### P2

- `/ads/pack`, `/ads/graphs`, `/ads/ai` のガードと導線が壊れていないことを確認する
- 修正後に build / deploy readiness まで持っていく

---

## 3. スコープ

### 対象

- `src/pages/SetupWizard.jsx`
- `src/api/adsInsights.js`
- 必要なら `src/contexts/AuthContext.jsx`
- 必要なら `src/contexts/AdsSetupContext.jsx`
- 必要なら `src/components/Layout.jsx`
- live deployed app on Vercel

### スコープ外

- Market Lens API
- `Compare` / `Discovery` / `CreativeReview`
- Multi-BQ 全面実装

---

## 4. 最優先で確認すること

## 4.1 最新 bundle を見ているか確認する

対象:

- deployed Vercel app
- browser cache
- loaded JS bundle

やること:

1. 本番 URL を開く
2. Chrome DevTools を開く
3. `Disable cache` を有効化
4. hard reload する
5. loaded bundle 名を確認する
6. もし必要なら page source / network から build asset hash を控える

確認ポイント:

- スクリーンショットの挙動が、現在の `SetupWizard.jsx` と一致しているか
- もし一致しないなら、まず deploy mismatch と判断する

受け入れ条件:

- 「いま見ている画面が最新 deploy かどうか」が Yes / No で明確になる

## 4.2 `list_periods` の request / response を生で確認する

対象:

- `/api/ads/list_periods`

やること:

1. `Network` タブで `Preserve log` を有効化
2. `/ads/wizard` の Step 1 で query type を選択
3. `次へ` を押して `list_periods` request を捕捉
4. 以下を必ず記録する
   - request URL
   - query string 全体
   - status code
   - response body
   - response headers の content-type

特に見る点:

- `query_types` がどう送られているか
  - repeated param
  - comma-separated string
  - label
  - id
- `Authorization` が付いているか
- `folder` / `case` / `project` 等の追加パラメータが要求されていないか

切り分け基準:

- `401` / `403`
  - auth 問題
- `200` + `[]`
  - request payload は受理されているが契約未充足
- `200` + periods があるのに UI に出ない
  - frontend parse 問題
- `422`
  - request schema 問題

## 4.3 `load` が `list_periods` と同じ format を使っているか確認する

対象:

- `/api/ads/load`

背景:

- 現コードでは `list_periods` で成功した「実際の送信形式」を保持していない疑いがある
- そのため Step 2 が通っても Step 3 で壊れる可能性がある

やること:

1. period が表示された場合は 1 件選ぶ
2. `次へ` を押して `/api/ads/load` request を捕捉
3. request body をそのまま記録する
4. `query_types` が `list_periods` と同じ形式か確認する

重要:

- ここは単なる成功可否だけではなく、**request shape の一致** を見ること

---

## 5. Workstream A: Live Verification

対象:

- deployed app
- Chrome DevTools

実施内容:

1. 最新 deploy / bundle 確認
2. `/ads/wizard` 実行
3. `list_periods` network capture
4. `load` network capture
5. `/ads/pack`, `/ads/graphs`, `/ads/ai` への遷移確認

成果物:

- request / response の証跡
- status code
- request payload
- response body
- 画面挙動との対応関係

受け入れ条件:

- period 不具合の原因候補が 1 つ以上排除され、真因候補が絞られる

---

## 6. Workstream B: Root Cause Fix

Live Verification の結果に応じて、以下のいずれかを行う。

### B-1. deploy mismatch の場合

やること:

- 正しい commit / deploy を確認
- キャッシュ無効化後に再確認
- 必要なら再デプロイ

### B-2. query_types format mismatch の場合

対象:

- `src/pages/SetupWizard.jsx`
- 必要なら `src/api/adsInsights.js`

やること:

- `list_periods` で成功した **実際の query_types format** を保持する
- そのまま `loadData()` に再利用する
- array / string のどちらが通ったかを state に持つ

望ましい shape の例:

```javascript
{
  mode: 'array' | 'comma-string',
  values: string[]
}
```

または

```javascript
{
  listPeriodsPayload: ...,
  loadPayload: ...
}
```

重要:

- 「論理的に同じ values」ではなく、「backend が実際に受け付けた payload 形式」を保持する

### B-3. missing parameter の場合

対象:

- `src/pages/SetupWizard.jsx`
- `src/api/adsInsights.js`

やること:

- `getFolders()` や他の prerequisite API のレスポンスを確認
- 必須の folder / case / project パラメータを UI または request に組み込む
- 使わない取得処理は残さない

### B-4. response parsing mismatch の場合

対象:

- `src/pages/SetupWizard.jsx`

やること:

- `extractPeriods()` を実レスポンス schema に合わせて拡張
- label / value 抽出ロジックも実データに合わせる

### B-5. auth propagation 問題の場合

対象:

- `src/api/adsInsights.js`
- `src/contexts/AuthContext.jsx`

やること:

- token 保存 / 復元
- Authorization header
- logout 後の状態リセット

を再確認する

---

## 7. Workstream C: Regression Check

`Setup Wizard` 修正後は、次も確認する。

1. `新しいセットアップ` で state が確実にリセットされる
2. logout 後に setup state が消える
3. `/ads/pack`, `/ads/graphs`, `/ads/ai` が guard される
4. setup 完了後は各 route に入れる
5. period 選択後の `load` が成功する

---

## 8. Agent Team で進める場合の分担

この作業は「ブラウザ実機確認」と「コード修正」が分離できるので、Claude 側で agent team が使えるなら並行化した方が速い。

### Lead / Integrator

責務:

- overall triage
- live findings の統合
- fix 方針決定
- final review

### Agent 1: DevTools Verifier

責務:

- 本番 URL を Chrome DevTools で確認
- bundle hash
- `list_periods`
- `load`
- auth header
- response body

を記録する

成果物:

- 実リクエスト証跡
- cause hypothesis

### Agent 2: Wizard Contract Worker

責務:

- `SetupWizard.jsx` の query_types format 取り回しを見直す
- 必要なら exact payload reuse を実装

担当ファイル:

- `src/pages/SetupWizard.jsx`

### Agent 3: Ads Client Worker

責務:

- `adsInsights.js` の request builder と auth まわりを見直す
- 必要なら params serializer を補強する

担当ファイル:

- `src/api/adsInsights.js`
- 必要なら `src/contexts/AuthContext.jsx`

### Agent 4: Regression QA Worker

責務:

- setup 完了後の route guard
- reset flow
- logout reset

の確認

担当ファイル:

- `src/contexts/AdsSetupContext.jsx`
- `src/components/Layout.jsx`
- `src/App.jsx`

### Agent 5: Build / Deploy Worker

責務:

- `npm run build`
- 修正後の再デプロイ確認
- live retest

---

## 9. Skill を使う場合の推奨

Claude 環境で skill が使えるなら、以下に相当する skill を優先する。

### 1. Browser / DevTools Verification

用途:

- network request capture
- cache bypass
- live deployed app verification

### 2. Repo Search / Contract Audit

用途:

- `list_periods`
- `load`
- `getFolders`
- auth token flow

の実装追跡

### 3. Frontend Integration

用途:

- request payload format の保持
- response parsing 修正
- UI state と API contract の整合

### 4. Release Verification

用途:

- build
- retest
- deploy readiness

---

## 10. 実装順

1. Agent 1 が live deployed app を DevTools で確認
2. その結果を待たずに Agent 2 は `SetupWizard.jsx` の format 保持設計を詰める
3. Agent 3 は `adsInsights.js` / auth flow を確認する
4. Lead が live findings を見て真因を確定
5. 必要な fix を実装
6. Agent 4 が guard / reset regression を確認
7. Agent 5 が build / deploy / retest

この順にする理由:

- live request の実態を見ないと推測で修正し続けることになる
- ただし format 保持の弱点はコード上ほぼ確実に存在するため、並行検討価値がある

---

## 11. 受け入れ条件

### 必須

- 最新 deploy を見ていることが確認できる
- `/api/ads/list_periods` の request / response が記録される
- `/api/ads/load` の request body が記録される
- Step 1 -> Step 2 -> Step 3 が本番で成立する
- 期間選択が UI 上で表示される
- build が通る

### 条件付き

- `folder` / `case` 追加が必要なら、それが request に反映される
- query_types format が array でも string でもよい
- ただし `list_periods` と `load` が実 backend 契約に一致していること

### 不可

- DevTools request を見ずに再度推測だけで修正すること
- `list_periods` と `load` で異なる format を黙って使い続けること
- period が出ないのに deploy だけ進めること

---

## 12. Claude にそのまま渡す指示文

```md
`plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md` を読んで、その plan に従って Setup Wizard の本番確認と原因切り分けを進めてください。

最優先は Chrome DevTools での live verification です。
推測ではなく、実際の request / response を見てください。

優先順位:
1. 最新 deploy / bundle を見ていることの確認
2. `/ads/wizard` の `list_periods` request / response の捕捉
3. period が出た場合は `/load` request body の捕捉
4. 真因に応じた修正
5. setup 完了後の guard / reset regression 確認
6. build / redeploy / retest

可能なら agent team で分担してください。
推奨ロール:
- devtools verifier
- wizard contract worker
- ads client worker
- regression QA worker
- build / deploy worker

skill が使える環境なら、browser/devtools verification、repo search/contract audit、frontend integration、release verification 系を優先してください。

特に以下を必ず報告してください:
- `list_periods` の request URL と query string
- status code
- response body
- `load` の request body
- `query_types` の実送信形式
- auth header の有無

注意:
- Setup Wizard を最優先にしてください
- DevTools request を見ずに推測だけで fix しないでください
- 最新デプロイを見ていない可能性も先に潰してください
```

