# Discovery Next Steps Plan (Codex / Claude Split) — 2026-04-05

## Decision

`Discovery Claude-only rollout` は完了扱いにする。

以後の論点は:

1. `Discovery` の user-facing 成功率を少しでも上げる
2. Render free tier 由来の cold start / timeout をどう扱うか決める
3. provider 切替作業に戻らない

## Ownership

### Codex が持つもの

- repo 内の実装変更
- retry / UX mitigation
- smoke script / operator doc 更新
- build / test 実行
- rollback 不要の範囲での小さな改善

### Claude に任せてよいもの

- Render Dashboard 上の目視確認
- startup log の転記
- 実運用ログの要約
- 手作業を含む観測結果の整理

### Claude に任せないもの

- repo 内の最終実装判断
- rollback / deploy 方針の最終整理
- `Gemini を戻す` 方向への誘導

## Immediate Plan

### Step 1. Codex: rollout tooling migration

`Discovery` の main path が `async /jobs + polling` に変わったため、
rollout script と operator docs を async 前提に切り替える。

目的:

- live smoke が legacy `/analyze` ではなく `/jobs` を検証する状態にする

### Step 2. Claude: live evidence capture

Render Logs から以下を確認する:

- `anthropic_analysis_model=...`
- `anthropic_discovery_search_model=...`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=...`

目的:

- Discovery Claude-only の live 証跡を残す

### Step 3. Codex: verify repo-side mitigation

- backend Discovery tests
- `npm run build`
- health-only smoke

### Step 4. Codex/Operator: async live smoke

- backend deploy
- frontend deploy
- async `render-probe`
- async `render-5`
- async `proxy-5`

### Step 5. Product decision

async 化後でも free tier 制約が目立つなら、次のどちらかに進む:

- `A.` Render plan を上げる
- `B.` `discovery/analyze` を async job + polling に変える

## Recommendation

次の main track は `async job + polling rollout` の live 完了。

したがって順番は:

1. Codex で async rollout tooling 更新
2. Codex で backend tests + frontend build 確認
3. Claude で live log capture
4. Codex / operator で async live smoke

## Explicit Non-Goals

- `GEMINI_DISCOVERY_*` を戻さない
- Discovery の provider tuning に戻らない
- generation 系 Gemini 実装を今回の判断に混ぜない
