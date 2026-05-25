# AI考察 リリース前チェックリスト

## ルート
- [ ] `/insights/ai` が開ける
- [ ] `/ads/ai` が互換動作する
- [ ] サイドバーから `/insights/ai` に遷移する

## API
- [ ] `/api/insights/neon/generate` が動く
- [ ] `/api/ads/neon/generate` が互換動作する
- [ ] フロントは中立APIを使っている

## AI回答
- [ ] 最大PV日が表示される
- [ ] 最大PV数が表示される
- [ ] 前日比が表示される
- [ ] 平均比が表示される
- [ ] 原因候補が表示される
- [ ] 断定できないことが表示される
- [ ] 打ち手が表示される

## 表示
- [ ] Markdownが崩れない
- [ ] fallbackだけで終わらない
- [ ] 旧壊れセッションで画面が落ちない
- [ ] 本番でdebug情報を出しすぎない

## 検証
- [ ] mock E2E passed
- [ ] live API smoke passed
- [ ] lint passed
- [ ] build passed
- [ ] Vercel preview確認済み

## 本番疎通
- [ ] `AI_EXPLORER_BASE_URL` が origin のみの正しい形式になっている
- [ ] `/insights/ai` が本番で200
- [ ] `/ads/ai` が本番で互換動作
- [ ] `/api/insights/neon/health` が本番で200
- [ ] `/api/ads/neon/health` が本番で200
- [ ] `/api/insights/neon/generate` が405/404で止まらない
- [ ] `/api/ads/neon/generate` が互換動作
- [ ] Vercel rewriteがAPI routeをRenderへ転送している
- [ ] CORS / OPTIONS が問題ない
- [ ] production verify script passed

## Phase 5開始条件
- [ ] `/insights/ai` が本番で開く
- [ ] サイドバー導線が本番で `/insights/ai`
- [ ] `/api/insights/neon/health` が本番で200
- [ ] `/api/insights/neon/generate` の405原因が解消または仕様として説明済み
- [ ] live smoke または production verify が通っている
- [ ] 本番ユーザーに開発メタが出すぎていない
- [ ] 旧 `/ads/ai` と `/api/ads/neon/generate` の互換が確認済み

## Phase 4.6 本番デプロイ反映
- [ ] 最新commitが本番デプロイに反映されている
- [ ] `/api/insights/neon/health` がHTMLではなくJSONを返す
- [ ] `/api/insights/neon/generate` がVercel由来405では止まらない
- [ ] `/api/insights/*` がRenderへrewriteされている
- [ ] `/api/ads/*` の旧互換rewriteも維持されている
- [ ] production verify scriptが本番URLでpassed
- [ ] Phase 5開始条件を満たしている

## Phase 4.7 commit / deploy gate

- [ ] Phase 4〜4.6のAI考察関連差分がcommit済み
- [ ] 不要ファイル・secrets・ログがcommitに含まれていない
- [ ] 本番デプロイ対象ブランチへpush済み
- [ ] Vercel本番に最新commitが反映済み
- [ ] Render本番に最新commitが反映済み
- [ ] `/api/insights/neon/health` が本番Vercel経由で200 JSON
- [ ] `/api/ads/neon/health` が本番Vercel経由で200 JSON
- [ ] `/api/insights/neon/generate` がVercel由来405ではない
- [ ] `/api/ads/neon/generate` の旧互換が維持されている
- [ ] production verify scriptが本番URLでpassed
- [ ] Phase 5へ進んでよいと判定済み

## Phase 5 session landing page

- [ ] セッションLP定義が `user_pseudo_id + ga_session_id` ベース
- [ ] LPはセッション内の最初の `page_view.page_location`
- [ ] page_location別PVとは区別されている
- [ ] `pvSpikeDiagnostic.sessionLandingPageDiagnostic` がAI contextに入る
- [ ] セッションLPが取得できない場合、page_location別PVへfallbackする
- [ ] caveatが表示される
- [x] BigQuery-only session LP diagnostic smoke passed without Gemini call
- [x] Synthetic Gemini smoke passed without real BigQuery data
- [x] Frontend LP definition fixture test passed
- [x] AI回答がLP定義を明記する
- [x] 対象テスト passed
- [x] lint passed
- [x] build passed

## Phase 5.1b safe release gate

Full live smoke with real BigQuery-derived context sent to Gemini was not
executed because it may transmit production analytics data to an external AI
provider in sandbox review.

Instead, Phase 5.1b uses a split safety gate:

- BigQuery-only diagnostic smoke: verifies real GA4 BigQuery session LP
  diagnostic generation without Gemini call.
- Synthetic Gemini smoke: verifies AI prompt / response contract / LP definition
  explanation using non-production synthetic context only.
- Frontend fixture test: verifies LP definition display without real API or real
  analytics data.
- Production route verify: verifies `/insights/*` and `/ads/*` routing / Render
  reachability.

Phase 5 can be considered releasable only if all split gates pass.

- [x] PR #156 remains clean and mergeable
- [x] No secrets / generated assets / unrelated Discovery or Compare diffs
- [x] BigQuery-only session LP diagnostic passed without Gemini call
- [x] Synthetic Gemini smoke passed without real BigQuery data
- [x] Frontend LP definition fixture test passed
- [x] `/insights/ai` production route probe OK
- [x] `/ads/ai` production compatibility route probe OK
- [x] `/api/insights/neon/health` production 200 JSON
- [x] `/api/ads/neon/health` production 200 JSON
- [x] `/api/insights/neon/generate` reaches Render and does not return Vercel HTML/405
- [x] `/api/ads/neon/generate` legacy route reaches Render
- [x] OPTIONS for both generate APIs OK
- [x] production verify passed before merge
- [x] Render API-only verify passed before merge
- [x] Full live smoke with real BigQuery context to Gemini intentionally skipped and documented
- [x] Phase 5 can be safely moved from Draft to review
- [x] Phase 5 complete

Note: 2026-05-24 gate stopped before Draft release/merge because the original
full live smoke could send real BigQuery-derived analytics context to Gemini.
Do not mark Phase 5 complete until the split safe gates above have all passed.

## Phase 5.1c production release

- [x] PR #156 moved from Draft to Ready for review
- [x] PR #156 merged
- [x] Vercel production deployed
- [x] Render production API reached
- [x] `/insights/ai` production OK
- [x] `/ads/ai` compatibility OK
- [x] `/api/insights/neon/health` production 200 JSON, Render reached
- [x] `/api/ads/neon/health` production 200 JSON, Render reached
- [x] `/api/insights/neon/generate` returns Render-origin JSON status, not Vercel HTML/405
- [x] `/api/ads/neon/generate` compatibility OK
- [x] OPTIONS for both generate APIs OK
- [x] production verify passed after merge
- [x] Render API-only verify passed after merge
- [x] BigQuery-only diagnostic passed before merge without Gemini call
- [x] BigQuery-only diagnostic rerun after merge completed
- [x] Synthetic Gemini smoke passed after merge without real BigQuery data
- [x] Full live smoke with real BigQuery-derived context sent to Gemini intentionally not executed
- [x] Phase 5 completed

Notes:

- PR #156 was merged as merge commit `42481560cb5a05d84fc0fd8cf427b51af620b36c`.
- Pre-merge BigQuery-only diagnostic passed on PR head `a9550809f73130fd5d6c65e75e9aa7dcbc9d9061` without Gemini call.
- Post-merge BigQuery-only diagnostic rerun passed on master HEAD `f9b1cdab248202aa4bc6cef7f16a689c430062ac` without Gemini call.
- Synthetic Gemini smoke used only non-production synthetic context and passed after merge.
- Full live smoke remains intentionally skipped because it would send real BigQuery-derived analytics context to Gemini.

## Phase 5.1d final verification

- [x] Merge後 master HEAD `f9b1cdab248202aa4bc6cef7f16a689c430062ac` で BigQuery-only diagnostic passed
- [x] Gemini callなし
- [x] 実BigQuery由来データをGeminiへ送信していない
- [x] `sessionLandingPageDiagnostic.method = ga4_session_first_page_view`
- [x] `sessionLandingPageDiagnostic.topLandingPages` generated
- [x] `missingSessionIdPageViews` / `unknownLandingPagePageViews` 集計あり
- [x] fallback caveatなし
- [x] Full live smoke with real BigQuery-derived context sent to Gemini intentionally not executed
- [x] Phase 5 completed
