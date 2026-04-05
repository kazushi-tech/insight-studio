# Discovery Token Pressure Reduction — Claude Handoff (2026-04-05)

目的:
Discovery の code path は成立した。
次は `Anthropic org rate limit` を踏みにくくするため、`analyze` prompt の token pressure を下げたい。

前提:
- Discovery は Claude-only で live
- async job + polling は live
- direct render path は `render-5 = 3/5` で pass
- proxy path は provider-limited で fail
- routing 問題ではなく、主失敗は `search timeout` と `analyze 429`

live で確認済み:
- backend live commit: `87e0f6a`
- `anthropic_discovery_search_model=claude-sonnet-4-6`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=claude-sonnet-4-6`
- Gemini Discovery 痕跡なし

今回 Claude にやってほしいこと:

1. `market-lens-ai/web/app/analyzer.py` を中心に、Discovery analyze prompt の肥大要因を特定する
2. まず low-risk な prompt compaction 案を作る
3. 可能なら prompt size 計測 log を追加する
4. 必要最小限の test 更新まで含めた patch 案を作る

優先順位:

第一候補:
- `body_text_snippet[:2000]` の削減
- `feature_bullets`, `faq_items`, `testimonials`, `secondary_ctas` の件数制限
- `_format_site_data()` の文面圧縮

第二候補:
- `build_deep_comparison_prompt()` の instruction text 圧縮

最後に検討:
- `MAX_COMPETITORS=5` を `4` に下げる

できれば避けたいこと:
- Discovery routing の変更
- provider 切替
- Gemini の再導入
- async job contract の変更
- unrelated generation-side changes

write scope の希望:
- `market-lens-ai/web/app/analyzer.py`
- 必要なら `market-lens-ai/tests/test_discovery_analyze.py`
- 必要なら新しい focused test 1-2 本

Codex に返してほしいもの:

1. 変更方針の要約
2. 実際の patch
3. 変更ファイル一覧
4. token pressure が下がる根拠
5. 残るリスク

参考ファイル:
- `plans/2026-04-05-discovery-token-pressure-reduction-plan.md`
- `plans/2026-04-05-discovery-postdeploy-stability-results.md`
- `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`
