# Infra Ticket Draft: Discovery Search-Stage Render Outbound Instability (2026-04-04)

## Summary

`Discovery` のアプリ側安定化は概ね完了したが、`stage=search` でのみ
Render outbound 起因と見られる intermittent failure が残っている。

現時点の整理:

- frontend regression: なし
- generic transport error: なし
- `stage=analyze` の Gemini `503` は backend retry/fallback 追加後に解消
- 残件は `stage=search` のみ

この ticket は `Discovery` を product bug ではなく
`Render outbound TLS / timeout` の infra track として扱うためのもの。

---

## Current Impact

- `Discovery` は成功する時は正常完走する
- ただし success rate はまだ `100%` ではない
- 失敗は `stage=search` の以下 2 パターンに集中している
  - `WRONG_VERSION_NUMBER`
  - search timeout (`502`)

現時点の user-visible impact:

- `Discovery` は使えるが intermittent
- UI では stage-aware error が表示され、generic failure には戻っていない

---

## Evidence

### v1: backend `ed3c5b4`

参照:

- `plans/2026-04-04-discovery-postdeploy-smoke-results.md`

結果:

- success: `2/5 (40%)`
- failure:
  - `stage=search` + SSL/TLS: `2`
  - `stage=analyze` + Gemini `503`: `1`

### v2: backend `74a86d7`

参照:

- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`

結果:

- success: `3/5 (60%)`
- failure:
  - `stage=search` + SSL/TLS: `1`
  - `stage=search` + timeout: `1`
  - `stage=analyze` + Gemini `503`: `0`

### Interpretation

- `74a86d7` により `stage=analyze` の Gemini overload 問題は解消
- 改善後も残る failure はすべて `stage=search`
- したがって、次の調査対象は `Discovery search transport` に限定してよい

---

## In Scope

- Render 実行環境から外部サイト/Gemini search 系への outbound TLS
- `DISCOVERY_SEARCH_*` timeout / retry 設定
- `trust_env` の実運用値と CA / proxy 影響
- Render runtime 上の Python / OpenSSL / cert bundle

## Out of Scope

- frontend UI
- generic transport error 対応
- `Creative Review`
- `stage=analyze` の Gemini `503` 再対応

---

## Suspected Causes

優先度順:

1. Render outbound の TLS handshake が intermittent に失敗している
2. `trust_env` / CA bundle / proxy まわりの設定が search path と噛み合っていない
3. search retry が timeout まで粘りすぎて `fast-fail + retry` のバランスが悪い

---

## Requested Infra Checks

### 1. Runtime / TLS

- Render service 上の Python / OpenSSL バージョン確認
- CA bundle の実参照先確認
- outbound HTTPS 接続で環境依存の proxy/cert が必要か確認

### 2. Render Config

- `DISCOVERY_SEARCH_TRUST_ENV` の実設定確認
- `DISCOVERY_SEARCH_TIMEOUT_SEC`
- `DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC`
- `DISCOVERY_SEARCH_MAX_RETRIES`
- `DISCOVERY_SEARCH_RETRY_DELAY_SEC`

### 3. Log Correlation

- `stage=search` failure の timestamp と Render log を突合
- `WRONG_VERSION_NUMBER` 発生時の直前 retry / timeout ログ確認
- 同時間帯の success/failure 混在状況を確認

---

## Suggested Next Changes

### Option A. Timeout/Retry Rebalance

- search の individual timeout を短めにして retry 回数を増やす
- 目的: 100s timeout 1 発で粘るより、短い retry 複数回に寄せる

### Option B. trust_env Verification

- Render 上で `DISCOVERY_SEARCH_TRUST_ENV=true/false` の差を観測
- `WRONG_VERSION_NUMBER` の発生率比較

### Option C. Baseline Observation

- 時間帯を変えて `10` 回以上の smoke
- 成功率ベースラインと error mix を把握

---

## Exit Criteria

この infra ticket を close 候補にしてよい条件:

- `stage=search` failure が十分に減少する
- 失敗が残っても発生条件を運用上説明できる
- success rate が現状 `60%` より改善する
- frontend / backend app bug と誤認しないだけの証跡が揃う

---

## References

- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results.md`
- `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`
- backend commit `ed3c5b4`
- backend commit `74a86d7`
