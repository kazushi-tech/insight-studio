# Prompt For Claude: Render Logs Confirmation For Discovery Claude-Only Rollout

## Goal

Render Production の startup logs から、`Discovery` が live で Claude-only 構成になっている証跡を確認したい。

この確認が取れたら、`Discovery Claude-only rollout` は完了として閉じる。
これは `async rollout` の live 完了判定とは別マイルストーン。

## Important Scope

- 対象は `Discovery` のみ
- `Gemini` を Discovery に戻す提案は不要
- generation / Gemini Vision 系は今回の対象外

## What To Check In Render Dashboard

Render service の `Logs` タブを開き、最新 deploy 後の startup log を確認してください。

確認したいキー:

- `anthropic_analysis_model=...`
- `anthropic_discovery_search_model=...`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=...`

可能なら合わせて確認:

- `default_analysis_provider=anthropic`
- live commit が `34c57b874fe70777c0fc0b29107586f85ad9b106`

## Expected Decision Rule

以下を満たせば `Discovery Claude-only rollout complete` と判定してよい:

1. startup log に `anthropic_*` snapshot が出ている
2. `anthropic_discovery_search_tool=web_search_20250305` が見える
3. Discovery 用 Gemini 設定を参照している痕跡がない
4. live health check の commit が `34c57b8...` で一致している

補足:

- これは startup snapshot の確認タスク
- `POST /api/discovery/jobs` の live 動作確認まではこのタスクに含めない

## Output Format

次の形式で返してください。

```text
Render service:
Observed at (JST):
Live commit:

Startup snapshot:
- anthropic_analysis_model=
- anthropic_discovery_search_model=
- anthropic_discovery_search_tool=
- anthropic_discovery_classify_model=
- default_analysis_provider=

Decision:
- Discovery Claude-only rollout complete: yes/no

Notes:
- Any mismatch or missing log lines
- Whether any Gemini discovery-related log was seen
```

## Repo Context

Relevant references:

- `C:\\Users\\PEM N-266\\work\\market-lens-ai\\web\\app\\main.py`
- `C:\\Users\\PEM N-266\\work\\market-lens-ai\\web\\app\\routers\\discovery_routes.py`
- `C:\\Users\\PEM N-266\\work\\insight-studio\\plans\\2026-04-05-discovery-claude-only-rollout-smoke-results.md`

## Explicit Non-Goals

- `GEMINI_DISCOVERY_MODEL` を追加しない
- `GEMINI_DISCOVERY_FALLBACK_MODELS` を追加しない
- provider tuning の議論に戻らない
