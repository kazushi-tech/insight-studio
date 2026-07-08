# Discovery Render Claude-Only Rollout Checklist (2026-04-04, Sync-Era Reference)

## Status

この checklist は `sync /api/discovery/analyze` 時代の rollout 記録用。

現在の main track は `async /api/discovery/jobs + polling` なので、
live deploy / smoke / acceptance は新しい async rollout checklist を優先する。

この文書は以下の用途に限定する:

- Claude-only 化の経緯確認
- 旧 smoke 結果との比較
- historical reference

## Goal

`Discovery` から Gemini 依存を外した backend deploy を、安全に Render 本番へ反映し、その場で確認する。

今回の目的は env-only tuning ではない。
`Discovery search` / `classify_industry` / `analyze` をすべて Claude 系に揃え、`Gemini を Discovery で一切使わない` 状態を live で確認する。

---

## Expected Backend State After Deploy

- `Discovery analyze` は Claude
- `Discovery search` は Claude Web Search
- `classify_industry` は Claude
- `provider=google` / `model=gemini-*` は Discovery では reject
- `GEMINI_DISCOVERY_*` は Discovery で不要

---

## Render Change Scope

今回の deploy で確認すべきもの:

- backend code deploy が新 commit で live になっている
- `ANTHROPIC_API_KEY` が有効
- Discovery 用の Claude search/classify env が必要なら入っている

任意の Discovery env:

```env
ANTHROPIC_DISCOVERY_SEARCH_MODEL=claude-sonnet-4-6
ANTHROPIC_DISCOVERY_CLASSIFY_MODEL=claude-sonnet-4-6
ANTHROPIC_DISCOVERY_SEARCH_TOOL_VERSION=web_search_20250305
ANTHROPIC_DISCOVERY_SEARCH_MAX_USES=4
```

---

## Do Not Do

- `GEMINI_DISCOVERY_MODEL` を追加しない
- `GEMINI_DISCOVERY_FALLBACK_MODELS` を追加しない
- Discovery のために `provider=google` を送らない
- generation 系 dirty changes をこの deploy に混ぜない

---

## Pre-Deploy Checklist

- [ ] deploy 対象が `market-lens-ai` Production である
- [ ] Discovery の Gemini 撤廃 commit を Render に反映する
- [ ] `ANTHROPIC_API_KEY` の存在を確認した
- [ ] 作業開始時刻 JST を控えた
- [ ] rollback 対象 commit を控えた

記録テンプレート:

```text
Date:
Operator:
Render service:
Change type: code deploy
Start time (JST):
Before live commit:
Rollback target:
```

---

## Deploy Steps

1. `market-lens-ai` の Discovery Gemini 撤廃 commit を push する。
2. Render Production deploy を起動する。
3. deploy 完了まで待つ。
4. health が復帰したことを確認する。
5. startup log で Discovery 関連 snapshot を確認する。

確認したい log:

- `anthropic_analysis_model=...`
- `anthropic_discovery_search_model=...`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=...`

---

## Immediate Verification Commands

### 1. Render health

```bash
npm run smoke:discovery:rollout:health
```

### 2. Render direct probe

```bash
npm run smoke:discovery:rollout:render-probe
```

期待:

- `200`
- `stage=complete`
- `fetched_sites >= 1`

### 3. Render 5-run

```bash
npm run smoke:discovery:rollout:render-5
```

見るもの:

- success rate
- `stage=search` fail の有無
- `stage=analyze` fail の有無
- `Gemini` 文言がもう出ていないこと

### 4. Local proxy 5-run

別ターミナル:

```bash
npm run dev
```

その後:

```bash
npm run smoke:discovery:rollout:proxy-5
```

---

## Recommended Run Order

1. `npm run smoke:discovery:rollout:health`
2. `npm run smoke:discovery:rollout:render-probe`
3. `npm run smoke:discovery:rollout:render-5`
4. `npm run dev`
5. `npm run smoke:discovery:rollout:proxy-5`

---

## Success Criteria

- `Discovery` 成功時に `report=true`
- search / analyze ともに Claude 系で完走
- `Gemini` 由来の error 文言が Discovery で出ない
- `provider=google` または `model=gemini-*` が reject される

---

## Rollback

問題が出た場合は、Gemini env を足すのではなく backend deploy を戻す。

Rollback 手順:

1. Render で前 deploy を re-deploy
2. health 復帰確認
3. `npm run smoke:discovery:rollout:render-probe`

---

## Operator Log

```text
Date:
Operator:
Render service:
Deploy commit:
Health restored at (JST):

Health:
- command: npm run smoke:discovery:rollout:health
- result:
- commit:
- artifact:

Render probe:
- command: npm run smoke:discovery:rollout:render-probe
- result:
- stage/class:
- artifact:

Render 5-run:
- command: npm run smoke:discovery:rollout:render-5
- success:
- failure:
- artifact:

Proxy 5-run:
- command: npm run smoke:discovery:rollout:proxy-5
- success:
- failure:
- artifact:

Decision:
Rollback needed:
```
