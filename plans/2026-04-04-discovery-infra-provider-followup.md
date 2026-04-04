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

## Ownership

- repo 内の記録整理と切り分け: `Codex`
- browser 実測の追加観測: `Claude` でも可
- backend / Render / provider の詰め: backend repo 側で実施
