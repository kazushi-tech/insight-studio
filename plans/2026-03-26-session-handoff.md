# Insight Studio Session Handoff

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**ブランチ:** `master`  
**現在の HEAD:** `fae84e82f3228cf06d47c11fdfd0974605b1c5ac`  
**現在のローカル状態:** コミット済み変更あり、未追跡は `.claude/` と `plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md`  

---

## 1. このセッションで何をやったか

このセッションでは、大きく 2 トラックを扱った。

1. `Market Lens` 連携不具合の切り分け、復旧方針の整理、Claude 実装のレビュー
2. `Setup Wizard` の期間選択不具合の再整理と、post-deploy の DevTools 検証計画の作成

重要なのは、最終時点での優先度が以下に整理されている点。

- `Market Lens` 側は、コード上はかなり改善済みで、follow-up までコミットされている
- いまの最大 blocker は `Setup Wizard`
- `Setup Wizard` はローカルコードレビューだけでは詰め切れず、**本番デプロイに対する Chrome DevTools 実機確認が必須**

---

## 2. セッション開始時の出発点

最初に読んだ handoff:

- `plans/2026-03-26-incident-handoff.md`

この handoff に書かれていた主要事実:

- `/ads/wizard`
  - Step 2 で `利用可能な期間がありません。`
- `/discovery`
  - `Market Lens API error: 404`
- `/compare`
  - `Market Lens API error: 404`

当初の整理:

- `Setup Wizard` は frontend regression の可能性が高い
- `Market Lens` は接続先自体が変わっている可能性が高い

---

## 3. Market Lens 側で判明したこと

ユーザーが別 repo の調査結果を共有してくれた。そこから、以下を前提として扱うことにした。

### 3.1 現行 backend URL

- 本番:
  - frontend: `market-lens-ai.vercel.app`
  - backend: `https://market-lens-ai.onrender.com`
- 開発:
  - frontend: `localhost:3001`
  - backend: `localhost:8002`

### 3.2 Insight Studio 側のズレ

当時の Insight Studio は以下の古い前提を持っていた。

- `vercel.json`
  - `market-lens-ai.vercel.app/api/*` に転送
- `vite.config.js`
  - 同じく `market-lens-ai.vercel.app` 前提
- `src/api/marketLens.js`
  - `GET /history`
  - `POST /review`
  - `X-Gemini-Key` header

### 3.3 現行 contract との違い

調査結果では以下が現行 contract として扱われた。

- `GET /api/scans`
- `POST /api/scan`
- `POST /api/discovery/analyze`
- `POST /api/reviews/{type}`
- `api_key` は request body

---

## 4. このセッションで作成した Market Lens 向け plan

### 4.1 初回復旧 plan

- `plans/2026-03-26-market-lens-recovery-plan.md`

目的:

- proxy 修正
- `marketLens.js` の現行 contract 追従
- `Compare` / `Discovery` / `Dashboard` / `AiExplorer` / `CreativeReview` の整理

### 4.2 Claude 実装レビュー後の follow-up plan

- `plans/2026-03-26-market-lens-followup-review-plan.md`

目的:

- `Dashboard` の 404 握りつぶし修正
- `AiExplorer` の `unavailable` と `error` 分離
- `Compare` の response-shape 追従
- `CreativeReview` unavailable UX の完結
- `api_key optional` と UI mandatory の仕様整理

---

## 5. Market Lens に対する Claude 実装と、そのレビュー結果

### 5.1 現在までにコミットされている関連コミット

最近の relevant commits:

- `7a65a3e`
  - `fix: Market Lens 復旧 — Proxy先・APIクライアント・全画面を現行backend契約に追従`
- `fae84e8`
  - `fix: Market Lens follow-up — error handling・Compare UI・CreativeReview unavailable完結`

### 5.2 レビューで確認した事実

現コードでは以下が反映済み。

- `vercel.json`
  - `/api/ml/:path*` は `https://market-lens-ai.onrender.com/api/:path*` に転送
- `vite.config.js`
  - `https://market-lens-ai.onrender.com` に向く
- `src/api/marketLens.js`
  - `scan()` は `{ urls, api_key }`
  - `discoveryAnalyze()` は `{ brand_url, api_key }`
  - `getScans()` は `/scans`
- `Dashboard.jsx`
  - 404 を空状態にせず error 表示
- `AiExplorer.jsx`
  - 404 のみ `unavailable`
  - その他は `error`
- `Compare.jsx`
  - `report_md` 主表示
  - score panel は score があるときだけ表示
- `CreativeReview.jsx`
  - clean な unavailable page に差し替え
- `Layout.jsx`
  - `クリエイティブ診断` に `停止中` バッジ

### 5.3 ただし smoke test 記録には注意点がある

確認した smoke test ファイル:

- `plans/2026-03-26-followup-smoke-test.md`

このファイルは useful だが、内部整合性に弱い点がある。

例:

- `/api/scans` は空配列と書いてあるのに
  - Dashboard success では履歴 table 表示と書いてある
- `/api/discovery/analyze` は 502 と書いてあるのに
  - Discovery success では competitor list rendered と書いてある

そのため、この smoke test は「完全な検証記録」ではなく、
**参考記録** として扱うのが安全。

### 5.4 現時点の判断

`Market Lens` 側は以下の認識でよい。

- 方向性はかなり良い
- 現行コードは当初より大幅に改善している
- ただし最終 acceptance としては、再度 live route verification を行う価値がある
- とはいえ、**いま最優先の blocker ではない**

---

## 6. Setup Wizard 側で今回確認した重要事項

### 6.1 現在の `SetupWizard.jsx` の実装

確認ファイル:

- `src/pages/SetupWizard.jsx`

現コードのポイント:

- query type は `id` と `label` の両方を持つ
- `resolvePeriods()` で以下を順番に試す
  - id 配列
  - id カンマ区切り
  - label 配列
  - label カンマ区切り
- `extractPeriods()` は複数 schema を吸収
- `loadSelectedData()` でも query type を再試行する
- `AuthContext` / `AdsSetupContext` / `Layout` / `App` は wizard gate と reset flow に対応済み

### 6.2 まだ残っている本質的なリスク

#### リスク A: `list_periods` と `load` で実際の format を揃えていない

`resolvePeriods()` は array と comma string を両方試すが、
成功した実 payload 形式そのものは保持していない。

実際に返しているのは:

- `queryTypes: values`

つまり values 配列のみ。

その結果:

- `list_periods` が comma string でしか通らない backend だった場合
- Step 1 は通っても Step 2 -> Step 3 の `/load` で壊れる可能性がある

#### リスク B: `getFolders()` を取っているのに使っていない

`getFolders()` は mount 時に呼んでいるが、UI でも request payload でも使っていない。

そのため:

- backend が folder / case / project の指定を暗黙に要求している場合
- `period` が出ない根本原因がまだ残っている可能性がある

#### リスク C: スクリーンショットと現コードの挙動が一致していない

現コードでは:

- `periods.length === 0`
  - error を出して Step 1 に留まる

しかしユーザーが見せた画面では:

- Step 2 に進んだ状態で
  - `利用可能な期間がありません。`

これは以下のどれかを示唆する。

- 最新 deploy を見ていない
- 古い bundle を見ている
- 本番 deploy 内容がローカルと違う
- 実際の挙動がコードレビューだけでは把握し切れていない

結論:

- `Setup Wizard` は **DevTools で live request を見るまで真因確定不可**

---

## 7. Setup Wizard 向けに作成した post-deploy debug plan

このセッションの最後に作成した plan:

- `plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md`

目的:

- 本番デプロイに対して Chrome DevTools で以下を確認する
  - 最新 bundle を見ているか
  - `/api/ads/list_periods` の request URL / query string / status / response body
  - `/api/ads/load` の request body
  - `Authorization` header の有無
  - `query_types` の実送信形式

この plan の核心:

- 推測で直し続けない
- まず DevTools で live request を捕まえる
- それを見て
  - deploy mismatch
  - auth 問題
  - query_types format 問題
  - missing parameter
  - response parse mismatch
  を切り分ける

---

## 8. 次チャットで最優先でやるべきこと

### 最優先

`Setup Wizard` の post-deploy live verification

具体的には以下。

1. 最新 deploy を本当に見ていることを確認する
   - hard reload
   - disable cache
   - bundle hash 確認

2. `/ads/wizard` で Step 1 -> Step 2 の `/api/ads/list_periods` を捕捉する
   - request URL
   - query string
   - status
   - response body
   - auth header

3. period が表示された場合は `/api/ads/load` も捕捉する
   - request body
   - `query_types` format

4. 真因に応じて fix する
   - format mismatch
   - missing folder/case param
   - auth propagation
   - response parsing
   - deploy mismatch

### その後

`Setup Wizard` が通ったら、以下を最終確認する。

- `/ads/pack`
- `/ads/graphs`
- `/ads/ai`

確認観点:

- guard
- setup state persistence
- logout reset

### Market Lens は最後に軽く再確認でよい

優先順位は下げてよい。

- `/`
- `/compare`
- `/discovery`
- `/ads/ai`
- `/creative-review`

---

## 9. いまの repo 状態

### ブランチと HEAD

- branch: `master`
- HEAD: `fae84e82f3228cf06d47c11fdfd0974605b1c5ac`

### 直近コミット

- `fae84e8`
  - `fix: Market Lens follow-up — error handling・Compare UI・CreativeReview unavailable完結`
- `7a65a3e`
  - `fix: Market Lens 復旧 — Proxy先・APIクライアント・全画面を現行backend契約に追従`
- `e6e16b6`
  - `feat: Phase 4 — テーマ切替・Wizard安定化・ウィザードゲート・AI考察ML連携`

### 現在の未追跡

- `.claude/`
- `plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md`

注意:

- worktree 上にコード差分は現時点では見えていない
- ただし deploy 状態は別途確認が必要

---

## 10. このセッションで参照・作成した主要ドキュメント

既存で参照:

- `plans/2026-03-26-incident-handoff.md`
- `plans/foamy-rolling-giraffe.md`
- `plans/phase3-api-wiring-handoff.md`

このセッションで作成:

- `plans/2026-03-26-market-lens-recovery-plan.md`
- `plans/2026-03-26-market-lens-followup-review-plan.md`
- `plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md`

Claude 生成 or 更新済み記録として参照:

- `plans/2026-03-26-followup-smoke-test.md`

---

## 11. 次チャットにそのまま投げる推奨プロンプト

```md
`plans/2026-03-26-session-handoff.md` と `plans/2026-03-26-setup-wizard-postdeploy-debug-plan.md` を読んで、続きから対応してください。

最優先は Setup Wizard です。
Market Lens は後回しで構いません。

やること:
1. 最新デプロイを本当に見ているか確認
2. Chrome DevTools で `/ads/wizard` の `list_periods` request / response を捕捉
3. period が出たら `/load` request body も捕捉
4. `query_types` の実送信形式、auth header、response body を根拠付きで報告
5. 必要な fix を実装
6. setup 完了後の guard / reset flow を確認

注意:
- 推測だけで直し続けないこと
- DevTools request を見てから判断すること
- `list_periods` と `load` の query_types format が一致しているか必ず確認すること
```

---

## 12. 一言で言うと

`Market Lens` はかなり前進した。  
次チャットの本丸は `Setup Wizard` であり、これは **Chrome DevTools を使った本番実機確認が必要なフェーズ** に入っている。

