# Claude Prompt: Discovery Phase A Post-Rollout v3 Smoke (2026-04-04)

## Purpose

Render 上の `Discovery search` 向け Phase A env 調整後に、
browser UI 実測ベースで成功率と failure mix が改善したかを確認するための Claude 用 prompt。

今回の論点は code regression ではなく、`stage=search` の
`TLS/SSL` と `timeout` が env 調整で改善するかどうか。

---

## Read First

まず以下を読む。

- `plans/handoff-2026-04-04-postdeploy.md`
- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`
- `plans/2026-04-04-discovery-render-outbound-infra-ticket.md`
- sibling repo `market-lens-ai`:
  - `plans/2026-04-04-discovery-search-env-tuning-plan.md`
  - `plans/2026-04-04-discovery-search-render-phase-a-rollout.md`

---

## Current Known State

- frontend regression は見えていない
- generic transport error は `0` を維持している
- `74a86d7` 後、`stage=analyze` の Gemini `503` は `0` になった
- 残件は `stage=search` のみ
  - `SSL/TLS`
  - `upstream_502 (timeout)`

比較対象となる baseline:

- v2 result: `3/5 success (60%)`
- failure:
  - `stage=search` + SSL/TLS: `1`
  - `stage=search` + timeout: `1`
  - `stage=analyze` + Gemini `503`: `0`

---

## Phase A Assumption

今回は code 変更後の smoke ではなく、Render 上で以下の Phase A env が適用済みである前提。

```env
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

重要:

- env-only rollout では health endpoint の commit hash が変わらない可能性がある
- したがって、deploy 確認は「現在 live な commit」「health 復帰」「Phase A 適用済みという作業前提」の 3 点で扱う
- env の実値を Claude が直接確認できない場合は、その制約を明記する

---

## What Claude Should Do

1. 現在の backend live 状態を確認する
2. Phase A 適用後の Discovery browser smoke を実施する
3. 前回 v2 (`3/5 success`) と比較する
4. 改善したか、横ばいか、悪化したかを判断する

---

## Deploy / Rollout Verification

確認したいこと:

1. Render の health endpoint が復帰しているか
2. backend live commit が何か
3. 今回の観測が「Phase A 適用後」であることを前提として扱えるか

補足:

- env-only 変更では commit hash 一致だけで rollout 完了とは言えない
- そのため、Claude は「health 復帰済み」「観測対象は Phase A 後の系」として整理し、
  env 実値の直接証明ができない場合はその旨を明記する

---

## Browser Smoke Conditions

固定条件:

- target URL: `https://www.petabit.co.jp`
- local origin: `http://127.0.0.1:3002` を優先
- request path: `/api/ml/discovery/analyze` (local proxy 経由)
- browser UI 実測を主軸にする
- direct API probe は補助に限定する

最低試行回数:

- `5` 回

可能なら:

- `6-10` 回まで増やしてもよい
- ただし最低でも前回比較のため `5` 回分の表は必須

---

## What To Record For Each Attempt

各試行で記録する:

- attempt number
- timestamp (JST)
- frontend origin
- status
- stage
- class
- UI message
- elapsed
- success / failure

成功時は可能なら以下も残す:

- report が表示されたか
- fetched competitors / sites が表示されたか

---

## Failure Classification

失敗時は必ず次のいずれかに寄せる。

- `stage=search` + SSL/TLS
- `stage=search` + upstream_502 / timeout
- `stage=search` + provider/load
- `stage=analyze` + Gemini 503/load
- `frontend regression`
- `test setup issue`
- `unknown`

今回の主目的は特にこの 3 点:

- `stage=search` SSL/TLS が減ったか
- `stage=search` timeout が減ったか
- `stage=analyze` の `503` が `0` 維持か

---

## Decision Rules

改善と言ってよい条件:

- success rate が `v2=3/5 (60%)` を上回る
- もしくは success rate が同等でも `SSL/TLS` と `timeout` のどちらかが明確に減る
- `generic transport error = 0` を維持
- `stage=analyze` Gemini `503 = 0` を維持

横ばいとみなす条件:

- success rate が `3/5` 前後
- failure の種類も v2 とほぼ同じ

悪化とみなす条件:

- success rate が `3/5` を下回る
- `generic transport error` が再発する
- `stage=analyze` の `503` が再発する
- frontend regression が出る

---

## Deliverables

Claude の返答には最低限以下を含める。

1. rollout / deploy 確認結果
2. 実行サマリー表
3. success 件数 / failure 件数
4. failure の stage 内訳
5. v2 (`3/5 success`) との比較
6. 現時点の結論
7. 次の推奨アクション

可能なら成果物として以下も更新する。

- `plans/2026-04-04-discovery-infra-provider-followup.md`
- 新規結果ファイル

---

## Security Rules

- secret を出さない
- `.env` の実値を表示しない
- API key をログや成果物に含めない
- direct API probe だけで結論を出さない

---

## Ready-To-Paste Prompt

以下を Claude にそのまま渡せる。

```text
まず以下を読んでください。
- plans/handoff-2026-04-04-postdeploy.md
- plans/2026-04-04-discovery-infra-provider-followup.md
- plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md
- plans/2026-04-04-discovery-render-outbound-infra-ticket.md
- sibling repo market-lens-ai:
  - plans/2026-04-04-discovery-search-env-tuning-plan.md
  - plans/2026-04-04-discovery-search-render-phase-a-rollout.md

前提:
- 今回は Discovery search 向け Phase A env 調整後の v3 smoke
- 比較対象の baseline は v2 = 3/5 success
- v2 では stage=search の SSL/TLS 1件、timeout 1件、stage=analyze の Gemini 503 は 0件
- env-only rollout なので commit hash だけでは Phase A 適用証明にならない可能性がある

やってほしいこと:
1. Render health を確認し、現在 live な backend commit を確認
2. ただし env-only rollout のため、health 復帰と今回の運用前提をもとに「Phase A 後の観測」であることを整理
3. local browser で http://127.0.0.1:3002 を優先し、https://www.petabit.co.jp を対象に Discovery を最低5回実行
4. 各試行で attempt number, timestamp, status, stage, class, UI message, elapsed, success/failure を記録
5. 前回 v2 と比較して、success率と failure mix が改善したか判断

失敗時の分類:
- stage=search + SSL/TLS
- stage=search + upstream_502 / timeout
- stage=search + provider/load
- stage=analyze + Gemini 503/load
- frontend regression
- test setup issue
- unknown

特に確認したいこと:
- stage=search の SSL/TLS failure が減ったか
- stage=search の timeout failure が減ったか
- stage=analyze の Gemini 503 が 0 を維持しているか
- generic transport error が再発していないか

守ること:
- secret を出さない
- .env の実値を表示しない
- direct API probe だけで結論を出さず、browser UI 実測を主軸にする
- env 実値を直接確認できない場合は、その制約を明記する

最後の返答に含めてほしいもの:
1. rollout / deploy 確認結果
2. 実行サマリー表
3. success件数 / failure件数
4. failureのstage内訳
5. v2 (3/5 success) との比較
6. 現時点の結論
7. 次の推奨アクション

可能なら成果物として以下も更新してください。
- plans/2026-04-04-discovery-infra-provider-followup.md
- 新しい結果ファイル
```
