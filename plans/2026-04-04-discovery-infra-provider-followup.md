# Discovery Follow-up: Intermittent Infra / Provider Track (2026-04-04)

## Context

`Discovery` の frontend / backend 契約整理は 2026-04-04 時点で一段落している。

この時点で確定していること:

- local browser の generic transport failure は frontend の direct/proxy 取り回しと backend CORS 修正で解消済み
- backend では `stage=search` などの stage-aware error contract が入っている
- browser UI では generic network error に潰れず、`Discovery` の失敗箇所を段階付きで表示できる

それでも残る失敗は、アプリのロジック不具合より
`Render outbound` / `provider` / `TLS` / `provider load` の intermittent 問題として扱うのが妥当。

---

## Current Status

2026-04-04 の観測では、以下のような揺れがあった。

1. `search` ステージで `502` 相当の SSL 一時エラー
   - 例: `WRONG_VERSION_NUMBER`
2. `search` は通るが `analyze` ステージで Gemini `503`
3. 以前のような browser 側 generic `Failed to fetch` ではなく、backend が stage-aware error を返せる状態には改善済み

結論:

- `Discovery` は「壊れている」のではなく「外部要因の揺れに晒される」状態
- この残件は frontend 修正トラックから分離し、infra/provider track として扱う

---

## Scope

この follow-up で見る対象:

- Render から外部 provider への outbound TLS/SSL
- Gemini API の一時的 `503` / load / retry 要件
- `trust_env=False` や CA 証明書バンドルの影響
- timeout / retry / observability の不足

この follow-up で見ない対象:

- `Creative Review`
- local browser CORS
- frontend の generic error UI
- `Discovery` の stage label 表示

---

## Evidence Snapshot

2026-04-04 時点の手元整理:

- browser UI:
  - `Discovery` 実行自体は可能
  - 失敗時も stage-aware な表示に改善済み
- backend:
  - `search` step で catch-all が入り、raw `500` を減らした
  - `_fetch_one()` でも例外が gather 全体を落としにくくなった
- remaining symptoms:
  - `502` SSL/TLS 系の一時エラー
  - `503` provider load 系エラー

---

## Working Hypotheses

優先度順の仮説は以下。

1. Render 実行環境から provider への TLS ハンドシェイクが不安定
2. `trust_env=False` により環境依存の proxy/cert 設定を拾えていない
3. Gemini 側の一時過負荷で `503` が返り、現行 retry 戦略では吸収しきれていない
4. timeout 値が provider 側の揺れに対して短く、recoverable failure を user-visible failure にしている

---

## Recommended Checks

### A. Runtime / TLS

- Render 上の Python / OpenSSL / cert bundle の実バージョン確認
- CA 証明書の参照先確認
- 同一リージョン / 同一サービスからの再現頻度確認

### B. HTTP Client

- `gemini_search_client.py` などで `trust_env=False` を使っている箇所の確認
- connect timeout / read timeout / overall timeout の実値確認
- SSL failure を retry 対象にできるか確認

### C. Provider Behavior

- Gemini `503` の発生時刻と頻度をログで集計
- request size / concurrency / burst の相関確認
- provider status page や quota 状況の照合

### D. Observability

- `stage`, `error_type`, `provider`, `status_code` を structured log へ残す
- `search` と `analyze` を分けて成功率を見られるようにする
- user-facing error と backend log を run 単位で突合できるようにする

---

## Suggested Actions

1. backend repo 側で `Discovery` 関連の client / timeout / retry 設定を棚卸しする
2. `trust_env=False` の採否を実環境前提で検証する
3. `503` / SSL failure の retry 方針を設計する
4. Render 側で TLS/CA 情報を確認する
5. `Discovery` の成功率を時間帯付きで 5-10 回観測し、infra/provider の揺れか常時不良かを切り分ける

---

## Exit Criteria

この track を close 候補にしてよい条件:

- `Discovery` 実行で browser UI が generic transport failure に戻らない
- `search` / `analyze` の失敗率が観測可能
- intermittent failure が「許容範囲まで低下」または「provider/infrastructure 既知事象」として運用判断できる
- 再発時に `frontend bug` と誤認しないだけの証跡がある

---

## Observation: Post-Deploy Smoke (2026-04-04 11:47 JST)

Backend commit `ed3c5b4` (transport retry hardening) の deploy 確認後に 5 回の smoke を実施。

### Results

- **Success: 2/5 (40%)**
- **Failure: 3/5 (60%)**
  - `stage=search` + SSL/TLS (`WRONG_VERSION_NUMBER`): 2 件
  - `stage=analyze` + Gemini `503 UNAVAILABLE`: 1 件
- **Generic transport error: 0 件**
- **Frontend regression: なし**

### Assessment

- Transport hardening (`ed3c5b4`) による改善効果は確認済み
  - stage-aware error が全失敗で機能
  - generic error への回帰なし
- 依然として Render outbound TLS と Gemini 503 の intermittent 問題は残存
- 成功率 40% は infra/provider track として継続追跡が必要
- 詳細: `plans/2026-04-04-discovery-postdeploy-smoke-results.md`

---

---

## Observation: Post-Deploy Smoke v2 (2026-04-04 12:18 JST)

Backend commit `74a86d7` (retry discovery analyze on gemini overload) の deploy 確認後に 5 回の smoke を実施。
前回 (v1) は `ed3c5b4` で `2/5 (40%)` だった。

### Results

- **Success: 3/5 (60%)** — 前回 2/5 (40%) から +20pt 改善
- **Failure: 2/5 (40%)**
  - `stage=search` + SSL/TLS (`WRONG_VERSION_NUMBER`): 1 件
  - `stage=search` + upstream_502 (timeout): 1 件
  - `stage=analyze` + Gemini `503 UNAVAILABLE`: **0 件** (前回 1 件 → 解消)
- **Generic transport error: 0 件**
- **Frontend regression: なし**

### Key Changes from v1

| 指標 | v1 (ed3c5b4) | v2 (74a86d7) |
|------|-------------|-------------|
| Success Rate | 40% | 60% |
| Gemini 503 | 1 件 | 0 件 |
| SSL/TLS | 2 件 | 1 件 |
| Search timeout | 0 件 | 1 件 |

### Assessment

- `74a86d7` の analyze retry 追加により Gemini 503 問題は解消
- 残存する failure は全て `stage=search` — Render outbound network 起因
- search timeout (100s) は retry が上限まで粘った結果の可能性
- **結論: analyze stage は安定化。search stage の Render outbound TLS が唯一の残件**
- 詳細: `plans/2026-04-04-discovery-postdeploy-smoke-results-v2.md`

### Updated Working Hypotheses

1. ~~Gemini 側の一時過負荷で `503` が返り、現行 retry 戦略では吸収しきれていない~~ → **解消 (74a86d7 で対策済み)**
2. Render 実行環境から外部サイトへの TLS ハンドシェイクが不安定 → **継続 (主残件)**
3. `trust_env=False` により環境依存の proxy/cert 設定を拾えていない → **継続**
4. search の timeout/retry バランスが最適でない可能性 → **新規仮説**

---

## Observation: Phase A v3 Smoke (2026-04-04 14:27 JST)

Phase A env 適用後に 5 回の browser UI smoke を実施。
前回 (v2) は `74a86d7` で `3/5 (60%)` だった。

### Phase A env

```env
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

### Results

- **Success: 3/5 (60%)** — v2 と同率 (横ばい)
- **Failure: 2/5 (40%)**
  - `stage=search` + upstream_502 (timeout): 1 件 (86.5s)
  - `stage=search` + SSL/TLS (`WRONG_VERSION_NUMBER`): 1 件 (32.4s)
  - `stage=analyze` + Gemini `503`: **0 件** (維持)
- **Generic transport error: 0 件** (維持)
- **Frontend regression: なし** (維持)

### Key Changes from v2

| 指標 | v2 (74a86d7) | v3 (Phase A) |
|------|-------------|-------------|
| Success Rate | 60% | 60% |
| SSL/TLS | 1 件 | 1 件 |
| Search timeout/502 | 1 件 | 1 件 |
| Gemini 503 | 0 件 | 0 件 |
| upstream_502 elapsed | 100.6s | 86.5s |
| SSL/TLS elapsed | 44.2s | 32.4s |

### Assessment

- Phase A の `trust_env=true` + shorter timeout + retry 3 で **failure の検出は速くなった**
- しかし **failure の発生自体は抑制できていない** (success rate 横ばい)
- env tuning だけでは Render outbound TLS 不安定は解消しない
- **結論: Phase A は fast-fail 効果あり、ただし根本改善には infra レイヤー対策が必要**
- 詳細: `plans/2026-04-04-discovery-phase-a-v3-smoke-results.md`

### Updated Working Hypotheses

1. ~~Gemini 側の一時過負荷で `503` が返り、現行 retry 戦略では吸収しきれていない~~ → **解消 (74a86d7)**
2. Render 実行環境から外部サイトへの TLS ハンドシェイクが不安定 → **継続 (主残件、env tuning では解消不可)**
3. ~~`trust_env=False` により環境依存の proxy/cert 設定を拾えていない~~ → **Phase A で `trust_env=true` に変更済み。効果は限定的**
4. ~~search の timeout/retry バランスが最適でない可能性~~ → **Phase A で調整済み。fast-fail は効いたが failure 率は変わらず**
5. Render outbound の TLS 問題は Python/OpenSSL/リージョン等の infra レイヤーに起因する可能性 → **新規仮説**

---

## Ownership

- repo 内の記録整理と切り分け: `Codex`
- browser 実測の追加観測: `Claude` でも可
- backend / Render / provider の詰め: backend repo 側で実施
