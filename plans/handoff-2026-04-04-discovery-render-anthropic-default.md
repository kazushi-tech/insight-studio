# Handoff: Discovery Render Investigation / Claude Analysis Default (2026-04-04)

## 0. Purpose

この handoff は、次チャットで `Discovery` の現状を即座に引き継ぐための詳細記録である。

今回のやり取りでは、`insight-studio` と sibling repo `market-lens-ai` をまたいで、以下を完了した。

1. `Phase A` env rollout と v3 smoke の整理
2. Render 上の `stage=search` timeout / TLS 問題の runtime 観測
3. `analysis` default を Gemini から Claude に切替
4. Anthropic default model を `claude-sonnet-4-6` に揃える
5. `provider=Claude` の live 実ログ確認

この handoff を読めば、次チャットは過去経緯を再探索せずに続行できる。

---

## 1. High-Level Conclusion

### 現時点の正しい理解

1. `Discovery analyze` の最終分析ステージは **Claude** に切り替わった
2. ただし `Discovery search` と `classify_industry` は **まだ Gemini 依存**
3. `Phase A` env は live で、rollback は不要
4. `Python 3.12.13` pin は live で、timeout 問題の根本解決にはならなかった
5. 残件は `stage=search` の provider / latency / retry / infra shaped issue
6. `GEMINI_ANALYSIS_MODEL` は事実上不要化した

### 一番短いまとめ

- `analysis = Claude`
- `search/classify = Gemini`
- `Phase A env = 維持`
- `Python pin = 維持`
- `main unresolved = Gemini search path`

---

## 2. Repos Involved

### `insight-studio`

目的:
- smoke 実行記録
- rollout / handoff / operator-facing docs

### `market-lens-ai`

目的:
- backend 実装
- Render deploy target
- runtime/TLS observability
- provider default 切替

---

## 3. Key Files To Read First

### `insight-studio`

- `plans/handoff-2026-04-04-discovery-render-anthropic-default.md` ← この handoff
- `plans/2026-04-04-discovery-phase-a-v3-smoke-results.md`
- `plans/2026-04-04-discovery-infra-provider-followup.md`
- `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`

### `market-lens-ai`

- `plans/handoff-2026-04-04-discovery-phase-a-to-infra.md`
- `plans/2026-04-04-discovery-render-runtime-tls-checklist.md`
- `plans/2026-04-04-discovery-search-model-rollout-plan.md`
- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/gemini_search_client.py`
- `web/app/services/discovery/keyword_extractor.py`
- `web/app/llm_client.py`
- `web/app/anthropic_client.py`
- `web/app/main.py`

---

## 4. Commits Already Pushed

### `insight-studio`

- `1e1f7a4` `docs: record discovery phase a v3 smoke results`
  - `plans/2026-04-04-discovery-phase-a-v3-smoke-results.md`
  - `plans/2026-04-04-discovery-infra-provider-followup.md`
  - `plans/2026-04-04-claude-prompt-discovery-phase-a-v3-smoke.md`

### `market-lens-ai`

- `cd8e150` `docs: hand off discovery phase a to infra track`
- `04d8fd0` `docs: add render runtime tls investigation checklist`
- `e924548` `fix: add discovery search tls observability`
- `c3c33b6` `build: pin python version to 3.12.13`
- `f027e2a` `docs: plan discovery search model rollout`
- `f95427e` `refactor: default analysis provider to anthropic`
- `34c57b8` `chore: align anthropic default model to sonnet 4.6`

---

## 5. Render State Confirmed In This Chat

### Phase A env

以下は live として operator が確認済み。

```env
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

### Runtime snapshot

Render Logs で確認済み:

- `python=3.12.13`
- `openssl=OpenSSL 3.0.17 1 Jul 2025`
- `default_cafile=/usr/lib/ssl/cert.pem`
- `default_capath=/usr/lib/ssl/certs`
- `certifi_path=/opt/render/project/src/.venv/lib/python3.12/site-packages/certifi/cacert.pem`

### Proxy / cert env snapshot

Render Logs で確認済み:

- `http_proxy=unset`
- `https_proxy=unset`
- `no_proxy=unset`
- `ssl_cert_file=unset`
- `requests_ca_bundle=unset`
- `curl_ca_bundle=unset`

解釈:

- `DISCOVERY_SEARCH_TRUST_ENV=true` は live だが、proxy/cert 系 env が空なので、実質効果は限定的

### Anthropic / provider snapshot

Render Logs で確認済み:

- `anthropic_api_key=set`
- `anthropic_analysis_model=claude-sonnet-4-6`
- `default_analysis_provider=anthropic`

User statement:

- `ANTHROPIC_API_KEY` はローテーション済み
- `GEMINI_ANALYSIS_MODEL` は Render から削除済み

この点について次チャットで再確認要求は不要。

---

## 6. What Was Verified About Discovery Behavior

### 6.1 Phase A v3 smoke summary

`insight-studio/plans/2026-04-04-discovery-phase-a-v3-smoke-results.md` に記録済み。

結論:

- v2: `3/5 success`
- v3 Phase A: `3/5 success`
- success rate は横ばい
- ただし fail elapsed は短縮
- `stage=analyze` Gemini `503` は 0 維持
- 残件は `stage=search`

### 6.2 Render runtime/TLS investigation

観測で分かったこと:

1. `Python 3.14.3` 時代にも timeout が出ていた
2. `Python 3.12.13` に pin しても timeout は再現
3. よって根本原因は `3.14 only` ではない
4. fresh run では TLS ではなく pure timeout が主症状だった

代表 evidence:

- old request: `6a3e94d902c1`
  - `brand_fetch` OK
  - `classify_industry` timeout
  - `search` timeout
- fresh request after Python pin: `8af38c856442`
  - `brand_fetch` OK
  - `classify_industry` OK
  - `search attempt 1` 25s timeout
  - `search attempt 2` 25s timeout
  - final `stage=search elapsed_ms=75001.8 outcome=timeout`

解釈:

- `search path` が依然として不安定
- `trust_env` / timeout tuning / Python pin だけでは解決しない

---

## 7. What Changed In Code

### 7.1 Search observability

`e924548` で以下を追加:

- startup 時の runtime TLS snapshot
- startup 時の runtime env snapshot
- `request_id` を search / retry / stage log に通す
- raw `ssl.SSLError` の retry / structured logging

対象:

- `web/app/main.py`
- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/gemini_search_client.py`

### 7.2 Python version pin

`c3c33b6` で `.python-version=3.12.13` を追加。

### 7.3 Analysis default -> Anthropic

`f95427e` で以下を変更:

- `provider/model` 未指定時の既定 provider を `anthropic` に変更
- `model=gemini-*` 明示時のみ Gemini に倒す
- startup log に `anthropic_analysis_model` と `default_analysis_provider=anthropic` を追加
- `classify_industry` が `GEMINI_ANALYSIS_MODEL` を見ないよう修正
- `Gemini search fallback` から `GEMINI_ANALYSIS_MODEL` を除去

主対象:

- `web/app/llm_client.py`
- `web/app/main.py`
- `web/app/services/discovery/keyword_extractor.py`
- `web/app/services/discovery/gemini_search_client.py`

### 7.4 Anthropic default model -> Sonnet 4.6

`34c57b8` で以下を変更:

- Anthropic default を `claude-sonnet-4-6` に変更
- 旧 `claude-sonnet-4-20250514` は compatibility alias として `claude-sonnet-4-6` に寄せる
- README / tests / startup default 表記も更新

対象:

- `web/app/anthropic_client.py`
- `web/app/main.py`
- `README.md`
- related tests

---

## 8. Live Log Evidence That Analysis Is Now Claude

`request_id=08930e09691b` の fresh successful run が最重要 evidence。

Render Logs で確認済み:

1. `Gemini Search request start ...`
2. `Gemini Search upstream returned 503, retrying ...`
3. `Gemini Search attempt 3 timed out after 25s, retrying ...`
4. `Grounded discovery search failed; using model-only fallback ...`
5. `stage=search ... outcome=ok`
6. `POST https://api.anthropic.com/v1/messages "HTTP/1.1 200 OK"`
7. `discovery_stage ... stage=analyze ... outcome=ok`
8. `discovery_pipeline_complete ... provider=Claude ... stages_ok`

重要な解釈:

- `search` はまだ Gemini
- `analyze` は Claude
- 現在の live behavior は意図どおり

---

## 9. Current Provider Split

### 既定状態

- `scan`: Claude default
- `review`: Claude default
- `discovery analyze`: Claude default

### まだ Gemini のまま

- `discovery search`
- `classify_industry`

つまり、`Gemini 完全撤廃` はまだ終わっていない。
今回終わったのは `analysis default の Claude 化` まで。

---

## 10. Current Recommended Understanding Of Env

### Keep

```env
ANTHROPIC_API_KEY=...
ANTHROPIC_ANALYSIS_MODEL=claude-sonnet-4-6
GEMINI_API_KEY=...
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

### Remove / no longer needed

```env
GEMINI_ANALYSIS_MODEL
```

ただし `GEMINI_API_KEY` はまだ必要。
`search/classify` が Gemini 依存だから。

---

## 11. Search Model Rollout Plan Exists But Was Not Yet Rolled Out

`f027e2a` と `plans/2026-04-04-discovery-search-model-rollout-plan.md` で、
次の env-only experiment を準備済み。

未適用の推奨値:

```env
GEMINI_DISCOVERY_MODEL=gemini-2.5-flash
GEMINI_DISCOVERY_FALLBACK_MODELS=gemini-2.5-flash-lite,gemini-2.0-flash
```

この変更は **まだ live に入れていない**。

現時点の Render snapshot では:

- `gemini_discovery_model=<default>`
- `gemini_discovery_fallback_models=<default>`

よって今 live なのは、依然として default chain:

- primary: `gemini-3-flash-preview`
- fallback: `gemini-3.1-flash-lite-preview` など

---

## 12. Unrelated Dirty Worktree To Avoid

`market-lens-ai` には、別トラックの generation 系 dirty changes がある。
今回の Discovery track では触らない。

代表:

- `web/app/gemini_vision_client.py`
- `web/app/routers/generation_routes.py`
- `web/app/schemas/banner_generation.py`
- `web/app/services/generation/banner_gen_service.py`

次チャットでも revert / mix しないこと。

---

## 13. What Is Fully Done vs Not Done

### Done

1. Phase A env rollout
2. v3 smoke result record
3. runtime/TLS observability
4. Python 3.12.13 pin
5. analysis default -> Anthropic
6. Anthropic default model -> `claude-sonnet-4-6`
7. live log confirmation of `provider=Claude`

### Not done

1. `Gemini complete removal`
2. `Discovery search/classify` migration away from Gemini
3. `search model rollout` (`gemini-2.5-flash`) experiment
4. final resolution of `stage=search` instability

---

## 14. Best Next Step In A New Chat

次チャットで優先すべき順番はこれ。

### Option A: 現実的な次手

`Discovery search` の model experiment を進める。

1. Render に以下を適用
   - `GEMINI_DISCOVERY_MODEL=gemini-2.5-flash`
   - `GEMINI_DISCOVERY_FALLBACK_MODELS=gemini-2.5-flash-lite,gemini-2.0-flash`
2. deploy 後に startup snapshot を確認
3. 1 回 direct request
4. request_id 単位で search retry / timeout / success を比較
5. 必要なら 5-run smoke

### Option B: 本当に Gemini 完全撤廃を進める

これは別タスクとして扱うべき。
必要なのは:

1. `Discovery search provider` の代替設計
2. `classify_industry` を Claude へ移すか削除する設計
3. `Gemini API key` を不要にする code path の整理

これは small patch ではなく、search architecture change。

---

## 15. Suggested Prompt For The Next Chat

```text
まず次の handoff を読んで全体状況を把握してください。

- insight-studio/plans/handoff-2026-04-04-discovery-render-anthropic-default.md

前提:
- analysis default は Claude に切替済み
- Render では anthropic_analysis_model=claude-sonnet-4-6, default_analysis_provider=anthropic を確認済み
- discovery search/classify はまだ Gemini 依存
- Phase A env と Python 3.12.13 pin は live
- search model rollout plan は未適用
- generation 系の dirty changes には触らない

次は search model rollout か、Gemini 完全撤廃の設計整理のどちらかを一気に進めてください。
```

---

## 16. Security Note

Anthropic API key は user がローテーション済みと明言している。
次チャットでは:

- 古い key の話を蒸し返さない
- 実値を出さない
- `.env` / Render secret の値を handoff に書かない

---

## 17. Final One-Paragraph Summary

`Discovery` の app-side hardening と Phase A rollout は完了しており、`analysis` default は live で `Claude` に切り替わった。`provider=Claude` と `POST https://api.anthropic.com/v1/messages 200 OK` も Render Logs で確認済み。一方、`search` と `classify_industry` はまだ Gemini 依存で、`stage=search` の 503 / timeout / fallback は残っている。`Python 3.12.13` pin と Phase A env は維持でよく、次チャットの実務は `GEMINI_DISCOVERY_MODEL` 実験を進めるか、Gemini 完全撤廃の設計に入るかの二択である。
