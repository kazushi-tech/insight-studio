# Handoff: Discovery Infra Track / Phase A Rollout Ready / Claude v3 Prompt Prepared (2026-04-04)

## 0. この handoff の位置づけ

この handoff は、2026-04-04 の一連の後続作業を次チャットへ安全に引き継ぐための最新版。

対象は主に 2 repo:

- `insight-studio`
- `market-lens-ai`

ここまでで `Creative Review` の正常系確認、`Discovery` の backend hardening、
post-deploy browser smoke、infra/provider track への切り出し、Phase A env 調整計画、
Render rollout runbook、Claude 用 v3 smoke prompt まで準備済み。

次チャットでは、この handoff を優先前提として扱えばよい。

---

## 1. 最終結論

現時点の結論は以下。

1. `Creative Review` の正常系は browser UI 実測で通過済み
2. `Creative Review review = Claude / generation = Gemini` の契約は維持
3. `Discovery` の generic transport error / frontend regression は再発していない
4. `Discovery stage=analyze` の Gemini `503` は backend fix 後に解消済み
5. `Discovery` の残課題は `stage=search` に限定される
6. 残件は product bug ではなく `Render outbound TLS/timeout` の infra track として扱うのが妥当
7. 次の実務ステップは code 追加ではなく、Render に Phase A env を適用して v3 smoke を回すこと

---

## 2. まず読むべきファイル

### insight-studio

- `plans/handoff-2026-04-04-postdeploy.md`
- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`
- `plans/2026-04-04-discovery-render-outbound-infra-ticket.md`
- `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`

### market-lens-ai

- `plans/2026-04-04-discovery-search-env-tuning-plan.md`
- `plans/2026-04-04-discovery-search-render-phase-a-rollout.md`
- `web/app/services/discovery/gemini_search_client.py`
- `web/app/gemini_client.py`
- `web/app/routers/discovery_routes.py`

---

## 3. ここまでに完了したこと

### 3-A. insight-studio 側

以下は既に commit / push 済み。

- `c593e2f` `docs: record stability validation and smoke tooling`
- `9fa5181` `docs: split discovery follow-up from stability track`
- `c59845f` `docs: record discovery postdeploy smoke findings`
- `0165fa8` `docs: capture discovery v2 smoke and infra ticket`

主に反映済みのファイル:

- `plans/handoff-2026-04-04-postdeploy.md`
- `plans/2026-04-04-commit-target-inventory.md`
- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`
- `plans/2026-04-04-discovery-render-outbound-infra-ticket.md`
- `plans/2026-04-04-claude-plan-discovery-postdeploy-smoke.md`
- `scripts/discovery-postdeploy-smoke.mjs`

加えて、まだ未コミットの新規ファイルが 1 つある。

- `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`

これは「Phase A env rollout 後に Claude へ投げる v3 smoke prompt」であり、
内容は完成済みだが、現時点では untracked。

### 3-B. market-lens-ai 側

以下は既に commit / push 済み。

- `ed3c5b4` `fix: harden discovery search transport retries`
- `74a86d7` `fix: retry discovery analyze on gemini overload`
- `bbbc65b` `docs: add discovery search env tuning plan`
- `9cc1074` `docs: add discovery search render rollout memo`

このうち技術的に重要なのは以下。

#### `ed3c5b4`

- `Discovery search` transport retry hardening
- Render 環境で `trust_env` を自動有効化
- `stage=search` の TLS/transport failure を retry しやすく改善
- `DISCOVERY_SEARCH_MAX_RETRIES` 既定値を強化
- `trust_env` 状態付きログを追加

対象ファイル:

- `web/app/services/discovery/gemini_search_client.py`
- `tests/test_search_client.py`
- `tests/test_gemini_search_deadline.py`

#### `74a86d7`

- `stage=analyze` の Gemini `503/high demand` に retry / fallback model を追加
- analyze error の user-facing message を humanize

対象ファイル:

- `web/app/gemini_client.py`
- `web/app/routers/discovery_routes.py`
- `tests/test_gemini_client.py`
- `tests/test_discovery_analyze.py`

#### `bbbc65b`

- Phase A / Phase B の env tuning plan を追加

対象ファイル:

- `plans/2026-04-04-discovery-search-env-tuning-plan.md`

#### `9cc1074`

- Render へ Phase A env を入れるための runbook を追加

対象ファイル:

- `plans/2026-04-04-discovery-search-render-phase-a-rollout.md`

---

## 4. Discovery の観測結果の流れ

### v1: `ed3c5b4` 後

Claude 実測結果:

- success: `2/5 (40%)`
- failure:
  - `stage=search` + SSL/TLS: `2`
  - `stage=analyze` + Gemini `503`: `1`
- generic transport error: `0`

記録:

- `plans/2026-04-04-discovery-postdeploy-smoke-results.md`

### v2: `74a86d7` 後

Claude 実測結果:

- success: `3/5 (60%)`
- failure:
  - `stage=search` + SSL/TLS: `1`
  - `stage=search` + upstream_502 (timeout): `1`
  - `stage=analyze` + Gemini `503`: `0`
- generic transport error: `0`
- frontend regression: `0`

記録:

- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`

### 解釈

- `74a86d7` により analyze 側の `503` は解消
- 残る failure はすべて `stage=search`
- したがって残件は backend app bug よりも
  `Render outbound TLS/timeout` として扱うのが正しい

---

## 5. Discovery の現在地

### 5-A. 閉じてよいもの

- frontend regression track
- generic transport error track
- `stage=analyze` の Gemini `503` 対応トラック

### 5-B. 開いたままのもの

- `stage=search` の `WRONG_VERSION_NUMBER`
- `stage=search` の `upstream_502 (timeout)`
- Render outbound / TLS / timeout バランス

### 5-C. いまの仮説

1. Render 実行環境から外部サイト側への TLS handshake が intermittent に不安定
2. `trust_env` の明示固定で吸収率が上がる可能性がある
3. search の 1 回あたり timeout が長すぎ、recoverable failure を timeout まで引っ張っている可能性がある

---

## 6. Phase A の内容

Render に適用したい Phase A env は以下。

```env
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

意図:

- `trust_env` を auto 判定でなく明示固定
- 1 回の待ちを短くし、長い hang を減らす
- `fast-fail + retry` に寄せる

詳細文書:

- `market-lens-ai/plans/2026-04-04-discovery-search-env-tuning-plan.md`
- `market-lens-ai/plans/2026-04-04-discovery-search-render-phase-a-rollout.md`

重要:

- この Phase A はまだ「文書化済み」であり、Render への実投入自体はこのチャットでは未実施

---

## 7. Claude 用 v3 smoke prompt

Phase A 適用後に Claude へ渡すための prompt は既に作成済み。

対象ファイル:

- `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`

この prompt の論点:

- env-only rollout 後の観測であること
- baseline は v2 の `3/5 success`
- 比較観点は以下:
  - `stage=search` SSL/TLS が減ったか
  - `stage=search` timeout が減ったか
  - `stage=analyze` の `503=0` を維持しているか
  - generic transport error が再発していないか

重要:

- このファイルは `insight-studio` ではまだ untracked / 未コミット

---

## 8. テスト / 検証メモ

### Creative Review

Claude による browser UI 正常系 smoke は 3 ケース通過済み。

1. Banner Review: PASS
2. Ad-LP Review: PASS
3. Generation: PASS

補足:

- `https://www.google.com` は Ad-LP smoke 用の安定 URL として通過確認済み
- `https://example.com/lp` は SSL 証明書検証で `422` になり得るため test data 不向き

### backend targeted tests

ローカル環境では `anthropic` パッケージ欠如のため、
一時 stub を使った targeted tests を実施している。

確認済み:

- Discovery 関連 test 群で `68 passed`
- repo には workaround を残していない

注意:

- `market-lens-ai` で pytest を再実行する際は、`anthropic` 欠如に留意すること

---

## 9. 現在の worktree 状態

### insight-studio

現在の `git status --short --branch`:

- branch: `master...origin/master`
- untracked:
  - `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`
  - 多数の `plans/*.md`
  - `scripts/phase2-smoke*.mjs`
  - `stitch2/`
  - `stitch2_LP/*`

重要な点:

- product code の pending tracked change は見えていない
- 今回 handoff 対象として重要なのは、
  `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md` が未コミットであること
- 他の untracked は過去作業や scratch の可能性が高いので勝手に消さない

### market-lens-ai

現在の `git status --short --branch`:

- branch: `main...origin/main`
- tracked dirty:
  - `web/app/gemini_vision_client.py`
  - `web/app/routers/generation_routes.py`
  - `web/app/schemas/banner_generation.py`
  - `web/app/services/generation/banner_gen_service.py`
- untracked:
  - `=1.0.0`
  - `data/`
  - 多数の `plans/*.md`
  - `stitch2/`
  - `tmp_review_assets/`

重要な点:

- generation 系 4 ファイルの dirty changes は今回の Discovery 作業とは無関係
- これらは user 側または別トラックの差分とみなし、勝手に revert しない
- `9cc1074` までは push 済み

---

## 10. 次チャットで最初にやるべきこと

優先順位はこの順がよい。

1. Render に Phase A env を適用する
2. health 復帰を確認する
3. Claude に `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md` を渡して v3 smoke を回す
4. 結果を `insight-studio/plans` に記録する
5. 必要なら `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md` 自体も commit する

---

## 11. 次チャットで Codex に頼むと自然なこと

- `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md` の commit
- Claude の v3 結果を docs に反映
- 成功なら Discovery infra ticket の close 条件整理
- 失敗なら Phase B または追加 observability メモ作成

---

## 12. セキュリティ / 運用上の注意

- `.env` の実値を出さない
- API key を成果物、logs、screenshots に残さない
- Render env の実値も必要以上に記録しない
- untracked scratch files を勝手に削除しない
- backend repo の generation 系 dirty changes を revert しない

---

## 13. 次チャット向けの最短要約

最短で引き継ぐなら、次の 4 点で足りる。

1. `Discovery` は analyze 側まで含めた code bug 修正は完了しており、残件は `stage=search` の Render outbound TLS/timeout のみ
2. backend 側では `ed3c5b4`, `74a86d7`, `bbbc65b`, `9cc1074` が push 済み
3. Render に入れるべき Phase A env と rollout runbook は文書化済み
4. Claude 用 v3 smoke prompt は [plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md](plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md) にあり、まだ untracked
