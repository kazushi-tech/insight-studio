# Discovery Token Pressure Reduction Plan (2026-04-05)

## Goal

Discovery の `Claude-only + async job` は成立したので、次は `Anthropic org rate limit` を踏みにくくする。

今回の目的は `routing` 修正ではなく、`analyze` 入力トークン量と burst 負荷を下げること。

## Why This Phase Exists

live で確認できた失敗は以下に収束している。

- `stage=search`: Claude Web Search busy / timeout
- `stage=analyze`: Anthropic `429 rate_limit_error`

この時点で code path 自体は成立している。
したがって次の改善対象は:

1. `search` 連打の負荷を下げる
2. `analyze` prompt の入力サイズを下げる
3. `report quality` を壊さずに token 使用量を下げる

## Recommended Ownership

### Claude Primary

このフェーズは `Claude` を主担当に寄せる。

理由:

- Codex weekly headroom が低い
- 調査と prompt 圧縮の試行錯誤が多い
- 複数案比較や prompt 編集は Claude に向く

Claude が持つタスク:

- token pressure の原因分解
- prompt 圧縮案の作成
- low-risk patch の叩き台作成
- operator 向け rollout note 更新案

### Codex Secondary

Codex は最後の narrow integration に限定する。

Codex が持つタスク:

- 最終 patch review
- test / build / smoke
- deploy
- regression 判定

## Phase Breakdown

### Phase 0. Baseline Lock

固定する事実:

- `Discovery Claude-only rollout complete`
- `render-probe`: pass
- `render-5`: `3/5`, pass
- `proxy-5`: fail
- live backend commit: `87e0f6a`

参照:

- `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`
- `plans/2026-04-05-discovery-postdeploy-stability-results.md`

### Phase 1. Token Pressure Measurement

対象:

- `market-lens-ai/web/app/analyzer.py`
- `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`
- `market-lens-ai/web/app/models.py`

やること:

- analyze 呼び出し直前で prompt 文字数を log に出す
- 可能ならサイト別 payload size も log に出す
- どのフィールドが prompt を膨らませているか洗う

確認したいポイント:

- `body_text_snippet[:2000]` が支配的か
- `feature_bullets`, `faq_items`, `testimonials` の寄与
- 競合数 `5` が多すぎるか
- 1URL + screenshot の multimodal path が token pressure を悪化させていないか

Exit criteria:

- 「何が何文字を食っているか」を説明できる

### Phase 2. Prompt Compaction

対象:

- `market-lens-ai/web/app/analyzer.py`

有力案:

1. `body_text_snippet` を `2000 -> 800` へ削減
2. `feature_bullets` を上位 `5` 件に制限
3. `faq_items` を上位 `3` 件に制限
4. `testimonials` を上位 `2` 件に制限
5. `secondary_ctas` を上位 `3` 件に制限
6. site formatting を箇条書き圧縮して冗長文を減らす
7. deep comparison prompt の指示文を短文化

優先順位:

- まずは data payload を削る
- 次に instruction text を削る
- competitor count の削減は最後

Exit criteria:

- report quality を大きく落とさず prompt size が明確に減る

### Phase 3. Load Shaping

対象:

- `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`
- `insight-studio/scripts/discovery-render-rollout-check.mjs`

有力案:

1. competitor count を `5 -> 4` に下げる比較案
2. semaphore / fetch pacing は原則維持
3. smoke の `pause` は `15s` 以上を維持
4. operator doc に「短時間連打で org limit を踏む」と明記

Exit criteria:

- synthetic smoke が provider limit を自己誘発しにくくなる

### Phase 4. Re-Verification

順序:

1. backend tests
2. deploy
3. `render-probe`
4. `render-5`
5. 必要なら `proxy-5`

Success criteria:

- `render-5` の失敗が減る
- 少なくとも `search timeout` の頻度が下がる
- `analyze rate limit` の発生頻度が下がる

## Concrete Task List

### Track A. Claude Investigation

1. `analyzer.py` と `discovery_pipeline.py` を読み、prompt の肥大ポイントを特定
2. prompt compaction の patch 案を作る
3. token pressure 計測 log の patch 案を作る
4. `MAX_COMPETITORS=5` を触る必要があるか判断する

### Track B. Codex Integration

1. Claude patch を review
2. repo に適用
3. test / build / smoke
4. deploy

## Risks

### 1. Quality regression

token を削りすぎると report の根拠が薄くなる。

対策:

- body text だけ先に削る
- features / FAQ / testimonials は最小限残す

### 2. Wrong bottleneck

本当に効いているのが token ではなく org tier の可能性がある。

対策:

- 計測を先に入れる
- rate limit 発生時の prompt size を log で確認する

### 3. Claude で広く触りすぎる

対策:

- write scope を `analyzer.py` と必要最小限の test に限定する

## Decision

このフェーズは `Claude primary / Codex final integration` が適材適所。
