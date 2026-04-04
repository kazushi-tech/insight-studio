# Claude Plan: Discovery Post-Deploy Smoke After Transport Retry Hardening (2026-04-04)

## Goal

`Discovery` の残課題がまだ `frontend bug` なのか、
それとも `Render outbound / provider / TLS / load` の intermittent 問題なのかを、
browser UI 実測で再確認する。

今回の目的は新規実装ではなく、`backend` に入れた transport hardening 後の再観測。

---

## Current Known State

### Frontend

- `insight-studio` 側の local browser transport 問題は解消済み
- `Discovery` は browser UI 上で stage-aware error を表示できる
- generic `Failed to fetch` / generic backend connection error を主症状として追う段階ではない

### Backend

`market-lens-ai` 側の `main` には以下が入っている前提。

- `458d944`
  - CORS allowlist
  - Discovery search error handling
  - image upload validation
- `e3e9890`
  - review routes の `ValueError` / `RuntimeError` handling
- `ed3c5b4`
  - Discovery search transport retry hardening
  - Render では `trust_env` を自動有効化
  - 短い deadline 下でも fast-fail `5xx` / transport error を retry しやすくした

重要:

- `ed3c5b4` は backend repo に push 済み
- ただし Render の deploy 完了そのものは、このプラン開始時点で Claude が確認すること

---

## Primary Questions

Claude に見てほしい論点はこの 4 点。

1. Render が `ed3c5b4` を取り込んだ状態で動いているか
2. `Discovery` の browser UI 実測で success 率が改善したか
3. 失敗が残る場合、`stage=search` か `stage=analyze` か
4. 残件が `SSL/TLS` 系か `Gemini 503/load` 系か

---

## Scope

このプランでやること:

- backend deploy 状態の確認
- local browser UI で `Discovery` を複数回実行
- 実行ごとの `status / stage / error detail / elapsed` 記録
- 必要なら network / console の追加観測
- `frontend / backend / provider / test data` の切り分け

このプランでやらないこと:

- `Creative Review`
- 新しい UI 実装
- unrelated repo cleanup
- secrets の露出

---

## Test Target

### Recommended URL

- `https://www.petabit.co.jp`

理由:

- これまでの Discovery smoke で継続使用しており比較しやすい
- test data を変えると原因切り分けがぶれやすい

### Browser Origin

優先順:

1. `http://127.0.0.1:3002` の local dev server
2. 既に preview が動いている場合のみ `http://127.0.0.1:3004`

原則:

- 既存の local frontend proxy `/api/ml` を使う
- direct backend URL を browser から叩く検証は、必要になった時だけ補助的に行う

---

## Execution Plan

### Step 1. Read Context

最初に読む。

- `plans/handoff-2026-04-04-postdeploy.md`
- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-claude-plan-discovery-postdeploy-smoke.md` ← この文書

### Step 2. Verify Backend Deployment

確認事項:

- backend repo `kazushi-tech/market-lens-ai`
- `origin/main` に `ed3c5b4` が存在すること
- Render service が `ed3c5b4` 相当まで deploy 済みか

確認できなかった場合:

- smoke は実施してよいが、「old deploy を見ている可能性あり」と明記する

### Step 3. Prepare Browser Smoke

前提:

- `.env` の `CLAUDE_API_KEY` / `GEMINI_API_KEY` は表示しない
- localStorage seed が必要なら既存 helper / 既存手順を利用する
- `Discovery` 実行に必要な設定が UI 上で有効になっていることを確認する

### Step 4. Run Repeated Discovery Smoke

最低 5 回、同じ条件で `Discovery` を回す。

固定条件:

- URL: `https://www.petabit.co.jp`
- local browser origin: `127.0.0.1:3002` を優先
- 同じ provider/key 条件で揃える

各試行で記録する:

- attempt number
- timestamp
- frontend origin
- request path
- HTTP status
- stage
- UI message
- elapsed time
- 成功なら `fetched_sites` / report 表示まで到達したか

### Step 5. Failure Classification

失敗時は必ず以下のどれかに寄せる。

- `stage=search` + SSL/TLS 系
- `stage=search` + provider temporary/load
- `stage=analyze` + Gemini `503` / overload
- `stage=fetch_competitors`
- `frontend regression`
- `test setup issue`
- `unknown`

### Step 6. Optional Supporting Checks

必要な場合のみ行う。

- browser network panel で `/api/ml/discovery/analyze` の response body 確認
- browser console error の確認
- health endpoint / simple API probe との比較

ただし:

- 調査の主軸は browser UI 実測
- direct API probe だけで結論を出さない

---

## Success Criteria

今回の smoke で「改善した」と言ってよい条件:

- `Discovery` が少なくとも複数回 success する
- 失敗しても generic transport error に戻らない
- 失敗の主因を `stage=search` または `stage=analyze` に切り分けられる

今回の smoke で「まだ infra/provider track 継続」と言う条件:

- success と failure が混在する
- failure が `SSL/TLS` または `503/load` に偏る
- frontend regression は見えない

今回の smoke で「code regression を疑う」条件:

- 以前解消した generic transport error が再発
- `/api/ml/discovery/analyze` に到達せず UI 側で壊れる
- stage marker が消えている

---

## Deliverables

Claude の返答に最低限含めるもの:

1. deploy 確認結果
2. 5 回分の実行サマリー
3. success / failure の件数
4. failure の stage 内訳
5. 現時点の結論
6. 次の推奨アクション

望ましい追加物:

- `plans/2026-04-04-discovery-infra-provider-followup.md` への追記
- あるいは新しい short handoff / observation memo

---

## Security Rules

- secret を出さない
- screenshot / report / artifact に key を残さない
- `.env` の実値を引用しない

---

## Claude Prompt

以下を Claude にそのまま渡せる。

```text
まず以下を読んでください。
- plans/handoff-2026-04-04-postdeploy.md
- plans/2026-04-04-discovery-infra-provider-followup.md
- plans/2026-04-04-claude-plan-discovery-postdeploy-smoke.md

やりたいこと:
- Discovery の backend transport retry hardening 後の browser UI smoke を実施
- backend repo market-lens-ai の origin/main にある ed3c5b4 相当が Render に deploy 済みか確認
- local browser では 127.0.0.1:3002 を優先し、https://www.petabit.co.jp で Discovery を最低5回回す
- 各試行について status / stage / UI message / elapsed を記録
- 失敗時は frontend / backend / provider / test setup のどれかに切り分ける
- generic transport error が再発していないかも確認

守ること:
- secret を出さない
- direct API probe だけで結論を出さず、browser UI 実測を主軸にする
- 最後に success件数、failure件数、stage内訳、現時点の結論、次アクションを簡潔にまとめる
```
