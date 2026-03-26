# Insight Studio — Market Lens Follow-up Review Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**目的:** Claude 実装後のレビュー findings を反映し、Market Lens 復旧を「接続しただけ」ではなく、実運用可能な状態まで詰める  
**前提:** `plans/2026-03-26-market-lens-recovery-plan.md` の後続 plan。`Setup Wizard` は引き続き別トラック

---

## 1. この plan が必要な理由

前回の Claude 実装で、以下は前進している。

- proxy 先を `market-lens-ai.onrender.com` に修正
- `src/api/marketLens.js` を旧 `/history` / `X-Gemini-Key` 前提から更新
- `GET /api/scans` への切り替え
- `CreativeReview` をいったん unavailable にした
- `npm run build` は成功

ただし、レビューの結果、まだ「完了」とは言えない問題が残っている。

### 主要 findings

1. `Dashboard` が `404` を空状態として握りつぶしている
   - 旧 `/history` 時代の暫定処理が残っている
   - いまの `/scans` では障害を隠す挙動になる

2. `AiExplorer` が履歴取得失敗をすべて `unavailable` にしている
   - `404`
   - `500`
   - timeout
   - CORS
   - 契約違反
   - を全部同じ見え方にしている

3. `Compare` は API 接続先こそ直ったが、UI が confirmed response shape にまだ追従していない
   - `report_md` は拾っている
   - しかし主要表示は依然として `overall_score` / `scores` に依存している
   - 実レスポンスで score が無い場合、成功しても KPI が `--` のまま残る可能性がある

4. `CreativeReview` の unavailable 化は方向性は正しいが、止め方が中途半端
   - route と nav は通常機能のように見える
   - ページ内文言に古いフロー説明が残る
   - 実行されない誤った review 呼び出しコードも残っている

5. `api_key` が optional という contract と、UI の `hasGeminiKey` 強制が整合しているか未確定
   - 仕様として強制するのか
   - backend contract に合わせて optional にするのか
   - 判断がまだ必要

---

## 2. この plan のゴール

### P0

- `Dashboard` と `AiExplorer` が障害種別を適切に扱う
- `Compare` が実レスポンス shape に合わせて meaningful な表示になる
- `CreativeReview` が「止まっているなら止まっている」と一貫して見える

### P1

- `api_key optional` の扱いを仕様として確定する
- live smoke test で、少なくとも配線・表示・障害表示が妥当であることを確認する

### P2

- commit / deploy 判断をできる状態まで整える

---

## 3. スコープ

### 対象

- `src/api/marketLens.js`
- `src/pages/Compare.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/CreativeReview.jsx`
- `src/components/Layout.jsx`
- 必要なら `src/App.jsx`

### スコープ外

- `Setup Wizard`
- Ads API
- Market Lens backend repo 側の修正
- 本格的な `CreativeReview` 再実装

---

## 4. Workstream A: Error Handling を障害隠蔽から診断可能な状態へ戻す

### A-1. Dashboard の `404 => empty` を廃止

対象:

- `src/pages/Dashboard.jsx`

現状の問題:

- `/api/scans` は現行の正規 endpoint
- ここで `404` が出るのは通常の「履歴なし」ではなく、配線異常か backend 障害
- 現在はそれを空状態として扱ってしまう

対応:

- `404` を特別扱いしない
- `historyError` に落として画面上で見えるようにする
- 空状態は「成功レスポンスで items が空」のときだけに限定する

受け入れ条件:

- `[]` が返れば「履歴なし」
- `404` や `500` なら error 表示

### A-2. AiExplorer の状態遷移を分離

対象:

- `src/pages/AiExplorer.jsx`

現状の問題:

- 失敗を全部 `unavailable` にしているため、ユーザーにも開発者にも原因が見えない

対応:

- `404` のみ `unavailable`
- `500` / timeout / JSON parse failure / network error は `error`
- `empty` は成功だが履歴ゼロ
- UI 上の文言も状態に合わせて分ける

受け入れ条件:

- `ready`
- `empty`
- `unavailable`
- `error`

が実際に意味の異なる状態になる

---

## 5. Workstream B: Compare を実レスポンス shape に合わせて再設計する

対象:

- `src/pages/Compare.jsx`
- 必要なら `src/api/marketLens.js`

現状の問題:

- confirmed response 例では `run_id`, `status`, `urls`, `extracted`, `report_md` が中心
- 現 UI の主表示は `overall_score` / `scores`
- このままだと、成功しても main panel が空に近い状態になりうる

先にやること:

1. `POST /api/scan` の実レスポンス shape を再確認
   - repo 定義
   - 可能なら live sample
2. `scores` が任意項目なのか、現行では存在しないのかを確定

実装方針:

- `report_md` を主表示にする
- `extracted` の中身が UI 価値の高い情報なら summary として表示
- score が無い場合でも成立するレイアウトにする
- score がある場合だけ補助表示する

禁止:

- score が無い contract に対して、`--` だらけの KPI panel を main UI として残すこと

受け入れ条件:

- scan 成功時に、最低でも「分析結果が返ってきた」と分かる情報が main area に表示される
- score がなくても broken impression にならない

---

## 6. Workstream C: CreativeReview の unavailable UX を完結させる

対象:

- `src/pages/CreativeReview.jsx`
- `src/components/Layout.jsx`
- 必要なら `src/App.jsx`

現状の問題:

- unavailable 方針は正しい
- しかし見た目上は通常機能に近く、説明文も古い
- 実行されない review call の死コードも残っている

対応:

1. ページ内文言を unavailable 前提に統一
   - 「URLを入力して診断」系の文言を撤去
   - 「asset upload workflow が必要なため停止中」と明示

2. dead code を整理
   - `reviewByType('ad-lp', { url }, geminiKey)` のような誤った暫定コードを残さない
   - 無効化するなら無効化として完結させる

3. nav / route の扱いを決める
   - sidebar に `一時停止中` を見せる
   - もしくは link 自体を disabled にする
   - route を残す場合でも landing page として unavailable 状態を返す

4. Dashboard など他画面の導線も必要に応じて調整
   - 「詳細を見る」などが誤誘導しないか確認

受け入れ条件:

- ユーザーがこの機能を「壊れている」のではなく「意図的に停止中」と認識できる
- 将来の本実装時に誤った request code が障害源として残らない

---

## 7. Workstream D: `api_key` 必須性を仕様として確定する

対象:

- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- 必要なら `src/pages/CreativeReview.jsx`
- 必要なら `src/api/marketLens.js`

確認事項:

- backend contract 上 `api_key` は optional / nullable
- しかし product としては BYOK を必須にしたい可能性がある

やること:

1. 仕様判断を明文化する
   - `api_key` は optional だが UI は必須
   - または UI でも optional にする

2. 判断後に UI を揃える

推奨:

- backend contract が optional でも、product として品質を担保したいなら UI 必須のままでもよい
- ただし、その場合は「contract に合わせた optional 化をした」とは言わないこと

受け入れ条件:

- `Compare` と `Discovery` の gating が、意図した仕様として説明可能な状態になる

---

## 8. Workstream E: 検証とリリース判断

対象:

- local build
- live smoke test
- deploy readiness

実施内容:

1. `npm run build`
2. live smoke test
   - `/compare`
   - `/discovery`
   - `/`
   - `/ads/ai`
   - `/creative-review`
3. 各 route で以下を確認
   - success 時の main UI
   - empty state
   - error state
   - unavailable state
4. commit / deploy は smoke test 通過後のみ

重要:

- 今回は「build が通る」だけでは完了扱いにしない
- live route confirmation を acceptance の一部にする

---

## 9. Agent Team で進める場合の分担

タスクは中規模で、契約確認と UI 調整が分離できる。Claude 側で agent team が使えるなら並行化した方がよい。

### Lead / Integrator

責務:

- 全体進行
- acceptance 判断
- commit / deploy 前レビュー

### Agent 1: Contract Verifier

責務:

- `scan` response shape の再確認
- `api_key optional` の扱い確認
- `CreativeReview` の asset upload 前提を根拠付きで整理

成果物:

- file path + line number 付きの contract summary

### Agent 2: Error Handling Worker

責務:

- `Dashboard`
- `AiExplorer`
- 必要なら `marketLens.js`

の状態遷移と error classification を修正

担当ファイル:

- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`
- 必要なら `src/api/marketLens.js`

### Agent 3: Compare UI Worker

責務:

- `Compare` を実レスポンス中心の UI に修正

担当ファイル:

- `src/pages/Compare.jsx`
- 必要なら `src/api/marketLens.js`

### Agent 4: CreativeReview UX Worker

責務:

- `CreativeReview` unavailable UX の完結
- nav / route / copy / dead code 整理

担当ファイル:

- `src/pages/CreativeReview.jsx`
- `src/components/Layout.jsx`
- 必要なら `src/App.jsx`

### Agent 5: QA / Release Worker

責務:

- build
- live smoke test
- 結果記録

---

## 10. Skill を使う場合の推奨

Claude 環境で skill が使えるなら、以下に相当する skill を優先する。

### 1. Repo Search / Contract Audit

用途:

- `scan` の response shape を再確認
- `api_key optional` の定義を根拠付きで確認
- `CreativeReview` の asset upload 前提を確認

### 2. Frontend Integration

用途:

- API client の shape と UI の期待値を揃える
- empty / error / unavailable の扱いを整理する

### 3. UX Guardrail

用途:

- unavailable 機能を中途半端な見せ方にしない
- broken ではなく paused と伝える

### 4. Release Verification

用途:

- build
- smoke test
- deploy readiness check

---

## 11. 実装順

1. Agent 1 が contract の再確認を行う
2. Agent 2 はそれを待たず `Dashboard` と `AiExplorer` の error handling を修正
3. 並行して Agent 3 が `Compare` UI を再設計
4. Agent 4 が `CreativeReview` unavailable UX を完結
5. Lead が `api_key` 必須性の仕様判断を反映
6. Agent 5 が build と live smoke test
7. acceptance を満たしたら commit / deploy 判断

この順にする理由:

- error handling と unavailable UX は contract 不確実性に依存しにくい
- `Compare` だけは response shape に少し依存するため、contract reconfirm があると安全

---

## 12. 受け入れ条件

### 必須

- `Dashboard` が `/api/scans` の `404` を空状態として握りつぶさない
- `AiExplorer` が `404` とその他の失敗を区別できる
- `Compare` が score 非依存でも main result を表示できる
- `CreativeReview` が unavailable 前提で一貫した UX になる
- `npm run build` が通る
- live smoke test の結果が記録される

### 条件付き

- `api_key` は optional でも required でもよい
- ただし UI と説明が一致していること

### 不可

- 「build が通った」だけで完了扱いすること
- `Dashboard` で障害を空状態として扱うこと
- `AiExplorer` で全失敗を `unavailable` にまとめること
- `Compare` に `--` だらけの主要パネルを残すこと
- `CreativeReview` に誤った request code を死蔵すること

---

## 13. Claude にそのまま渡す指示文

```md
`plans/2026-03-26-market-lens-followup-review-plan.md` を読んで、その plan に従って follow-up 修正を進めてください。

今回の目的は「Market Lens に繋がるようにした」段階から、「障害を隠さず、UI も contract に合った状態」に引き上げることです。

優先順位:
1. `Dashboard` と `AiExplorer` の error handling 修正
2. `Compare` を実レスポンス shape に合わせて再設計
3. `CreativeReview` unavailable UX の完結
4. `api_key optional` の扱いを仕様として確定
5. build と live smoke test

可能なら agent team で分担してください。
推奨ロール:
- contract verifier
- error handling worker
- compare UI worker
- creative review UX worker
- QA / release worker

skill が使える環境なら、repo search / contract audit / frontend integration / UX guardrail / release verification 系を優先してください。

注意:
- `Setup Wizard` はこの plan のスコープ外です
- `npm run build` 成功だけでは完了扱いにしないでください
- live smoke test を acceptance に含めてください
- `CreativeReview` は復旧できないなら、壊れたコードを残さず unavailable として完結させてください
```

