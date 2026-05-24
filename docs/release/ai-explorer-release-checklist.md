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
- [ ] live BigQuery smoke passed
- [ ] AI回答がLP定義を明記する
- [ ] 対象テスト passed
- [ ] lint passed
- [ ] build passed
