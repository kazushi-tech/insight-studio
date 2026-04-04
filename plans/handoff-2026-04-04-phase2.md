# Handoff: Stability Hardening / Phase 0-3A Review to Phase 2 Frontend (2026-04-04)

## セッション要約

この一連の作業で、Insight Studio の安定化について以下まで進んだ。

- `Phase 0` baseline scenario 文書化
- `Phase 1` Claude First 化
- `Phase 0 live smoke`
- `Phase 0.6 provisioned happy-path smoke`
- `Phase 3-A` local browser transport blocker 調査と最小修正

現時点の結論は以下。

1. `Claude key` provisioning は解消済み
2. `Ads AI` は happy path 実測成功
3. `Compare / Discovery / Creative Review` の browser 側 generic connection failure は、local frontend の transport 設計で再現していた
4. local frontend は最小修正で改善済み
5. 残っているのは frontend generic transport error ではなく、backend / provider 側の個別失敗
6. 次に進むべきは `Phase 2 frontend`。backend は別トラックで扱う

---

## 1. 参照すべきファイル

次セッションで最初に読むべきファイル:

- `plans/2026-04-03-stability-hardening-plan.md`
- `plans/2026-04-03-baseline-smoke-scenarios.md`
- `plans/handoff-2026-04-04-phase2.md` ← この handoff
- `src/api/marketLens.js`
- `src/contexts/AnalysisRunsContext.jsx`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- `src/pages/AiExplorer.jsx`
- `vite.config.js`

参照用 backend コピー:

- `tmp_market_lens_ai_repo/web/app/main.py`

---

## 2. 完了済み内容

### 2-A. Phase 0 / Phase 1

Codex セッションで以下を完了済み。

- baseline scenario 文書を追加
  - `plans/2026-04-03-baseline-smoke-scenarios.md`
- `Claude API キー` を core requirement に整理
- `Gemini API キー` は改善バナー生成だけの optional / experimental addon に整理
- 以下の UI 文言・状態表示を調整
  - `src/components/Layout.jsx`
  - `src/components/GuideModal.jsx`
  - `src/pages/Dashboard.jsx`
  - `src/pages/Settings.jsx`
  - `src/pages/CreativeReview.jsx`

この時点で build は成功。

### 2-B. Phase 0 live smoke / 0.6 provisioned smoke

smoke 結果は `plans/2026-04-03-baseline-smoke-scenarios.md` に詳細記録済み。

主要事実:

- 初回 live smoke では `Claude/Gemini/Auth/Setup` 未投入のため A-E 全件 blocked
- `scripts/provision_smoke_profile.mjs` を追加し、isolated profile に
  - Ads auth
  - case auth
  - Ads setup
  - Gemini
  - Claude
  を再現可能に seed できるようにした
- `Claude key` を `.env` から `node --env-file=.env` で helper に読ませる方式を確立

### 2-C. Phase 0.6 実測結果

helper + isolated profile で以下を確認済み。

- `Ads AI`: success
- `Compare`: browser 側で generic backend connection error
- `Discovery`: browser 側で generic backend connection error
- `Creative Review(review only)`: browser 側で generic backend connection error
- `Creative Generation`: review prerequisite missing

この時点では `Claude key` 不足ではなく `browser -> direct Market Lens backend` が主 blocker と判断。

### 2-D. Phase 3-A transport 調査と修正

原因は backend CORS allowlist 不足。

より正確には:

- Render backend は `http://localhost:3002` は許可
- しかし smoke 実測で使っていた `http://127.0.0.1:3002` と `http://127.0.0.1:3004` は未許可
- browser direct request は
  - `GET /health` で `No 'Access-Control-Allow-Origin' header`
  - `POST /scan`, `/discovery/analyze`, `/reviews/banner` で preflight failure
  - 最終的に `TypeError: Failed to fetch`
- Node probe は CORS を強制しないため backend に到達できた

frontend 側では最小修正として以下を実施済み。

- `src/api/marketLens.js`
  - local browser (`localhost` / `127.0.0.1`) では long-running endpoint でも direct Render を使わず `/api/ml` proxy を使う
- `vite.config.js`
  - `preview.proxy` を `server.proxy` と同じ設定に揃えた

補助検証:

- browser transport probe を追加
- provisioned UI smoke を追加

---

## 3. 現在の到達点

### frontend local blocker の扱い

`Phase 3-A` は以下の意味では完了扱いでよい。

- local dev / preview での generic `backend connection error` は frontend proxy 経由で回避できる
- browser で `/api/ml` 経由の実レスポンスが見えるようになった

### 実測で確認できていること

- `Ads AI`
  - success 継続
- `Compare`
  - transport blocker 解消
  - proxy 経由で `200`
- `Discovery`
  - transport blocker 解消
  - proxy 経由で `200` または backend error を受け取れる
  - dev 実測では `500 Internal server error (SSLError)` あり
- `Creative Review(review only)`
  - transport blocker 解消
  - proxy 経由で `422 Could not process image` を受け取れる
- `Creative Generation`
  - review prerequisite missing のまま

### 重要な解釈

今残っているのは、

- frontend の generic transport error

ではなく、

- backend / provider / upstream 側の個別エラー

である。

したがって、次に進むべきは `Phase 2 frontend` であり、backend 調査は別トラックでよい。

---

## 4. 次セッションでやるべきこと

### 優先度 P0: Phase 2 frontend

主担当は `Claude` 推奨。

目的:

- `Compare / Discovery / Creative Review / AiExplorer` の state/error 表示を揃える
- `timeout / cold start / transport / upstream/backend / invalid input / schema mismatch` を同じ見え方にしない
- retry 時の入力保持を改善する
- `unavailable` と `empty` の誤用を減らす

対象ファイル:

- `src/api/marketLens.js`
- `src/contexts/AnalysisRunsContext.jsx`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/CreativeReview.jsx`
- `src/pages/AiExplorer.jsx`

制約:

- Phase 3 transport 再設計はやらない
- backend repo は触らない
- prompt / validator / packet work はやらない

### 優先度 P1: focused smoke 再実施

Phase 2 後に以下を再確認する。

- `Ads AI`: success 維持
- `Compare`: success or at least meaningful backend result
- `Discovery`: generic transport error ではなく、stage-aware or backend-aware error
- `Creative Review`: upload/asset state を保持したまま 422/backend error を表示
- `AiExplorer`: unavailable / empty / error の区別

### 優先度 P2: backend 別トラック

frontend と混ぜずに別タスク化する。

1. `tmp_market_lens_ai_repo` 由来の backend CORS allowlist に
   - `http://127.0.0.1:3002`
   - `http://127.0.0.1:3004`
   を追加すべきか検討
2. `Discovery` の `SSLError` 調査
3. `Creative Review` の `422 Could not process image` 調査

---

## 5. 既に用意されているプロンプト

このチャットで次セッション向けに既に作成済み。

- `Claude向け Phase 2 実装プロンプト`

推奨フロー:

1. 新しいセッションを開く
2. この handoff と `plans/2026-04-03-stability-hardening-plan.md` を読む
3. 既存の `Claude向け Phase 2 実装プロンプト` を使う
4. 実装後、focused smoke を回す
5. 必要なら Codex で review / verify をかける

---

## 6. 変更済み/重要ファイル

この流れで重要だったファイル:

- `plans/2026-04-03-stability-hardening-plan.md`
- `plans/2026-04-03-baseline-smoke-scenarios.md`
- `scripts/provision_smoke_profile.mjs`
- `src/api/marketLens.js`
- `vite.config.js`

補助 artifact:

- `.tmp-phase-0-6/`
- `test-results/`
- 一時 screenshot / manifest 類

注意:

- これらの artifact は検証用。不要なら後で整理してよい
- secret 自体は docs/log/report に残さないこと

---

## 7. セキュリティ/秘密情報メモ

- `.env` に `CLAUDE_API_KEY` / `GEMINI_API_KEY` が入っている可能性がある
- `scripts/provision_smoke_profile.mjs` は env から key を読む
- manifest を書き出す場合、結果ログに key を残さないこと
- raw manifest は作業後に削除済み、今後も同方針を維持すること

---

## 8. 最終判断

### 今すぐやってよいこと

- `Phase 2 frontend` に進む

### まだ完全クローズではないもの

- `Phase 3-A` を backend 含めて完全完了とは言わない

ただし、frontend repo 側の local dev/preview blocker は十分解消されており、次の frontend 実装フェーズに進んでよい。

