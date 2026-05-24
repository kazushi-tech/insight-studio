# セッションLP SQL 次フェーズ設計メモ

## 現状

AI考察のPV急増診断では、LP候補を `page_view` イベントの `page_location` ベースで集計している。これは「最大日に多く見られたページ」を見るには有効だが、GA4の厳密なセッション開始時ランディングページとは異なる場合がある。

## 目標

次フェーズでは、GA4 BigQuery Exportからセッション単位のLanding Pageを算出し、source / medium、campaign、device と同じ粒度で最大日・前日差分・寄与度を比較できるようにする。

## 実装候補

- `event_name = 'session_start'` を起点にする
- `user_pseudo_id` と `ga_session_id` を組み合わせてセッションキーを作る
- `event_params` から `page_location` を取り、セッション内の最初のpage_viewをLanding Page候補にする
- `event_timestamp` でセッション内イベントを並べ、最初の `page_view` を採用する
- `session_traffic_source_last_click`、`collected_traffic_source`、`traffic_source`、event_params内source / medium を既存fallback順で使う
- `device.category` が存在する場合は同じセッションキーに紐づける

## 注意点

- GA4 Exportのschema差異があるため、1つのtraffic source列に決め打ちしない
- 同一セッション内で複数page_viewがある場合、最初のpage_viewのみをLPとして扱う
- `session_start` に `page_location` がないpropertyもあるため、最初のpage_view fallbackを用意する
- timezone変換と `_TABLE_SUFFIX` の範囲は既存BigQuery接続ロジックに合わせる
- campaign `(organic)` は広告キャンペーン施策名として扱わない

## テスト方針

- fixtureで `user_pseudo_id` + `ga_session_id` + 複数page_viewの最初のページが採用されることを確認
- source / medium 別、campaign別、device別でLP集計が崩れないことを確認
- schema欠損時は空配列とcaveatで安全にfallbackすることを確認
- AI_CONTEXTには「sessionLandingPage」と「pageLocationBasedLandingPage」を区別して入れる

## Phase 5開始条件

厳密なセッションLP SQLに入る前に、AI考察の本番導線が以下を満たしていることを確認する。

- `/insights/ai` が本番で開く
- サイドバー導線が本番で `/insights/ai` に到達する
- `/api/insights/neon/health` が本番で200を返す
- `/api/insights/neon/generate` の405原因が解消済み、またはPOST専用などの仕様として説明済み
- live smoke または production verify が通っている
- 本番ユーザーに `parse_status`、`fallback_used`、raw response などの開発メタが出すぎていない
- 旧 `/ads/ai` と `/api/ads/neon/generate` の互換動作が確認済み

## Phase 5実装メモ

### SQL方針

Phase 5では、既存のBigQuery接続と `run_query_with_params` を再利用し、AI考察のPV急増診断内に専用SQLを追加した。

- 対象テーブルは既存datasetIdの `events_*`
- `_TABLE_SUFFIX` は分析開始日の1日前から終了日まで
- 対象イベントは `event_name = 'page_view'`
- `ga_session_id`、`page_location`、`page_title` は `event_params` から取得
- schema差異で落ちやすい `batch_page_id`、`batch_ordering_id`、`session_traffic_source_last_click`、`collected_traffic_source` は参照しない

### session_key定義

`session_key = user_pseudo_id + '-' + ga_session_id`

`ga_session_id` または `user_pseudo_id` がない `page_view` はセッションLPへ帰属せず、`missingSessionIdPageViews` として集計する。

### landing page定義

`session_landing_page = 同一 session_key 内で最初に発生した page_view.page_location`

`session_landing_page_title = 同一 session_key 内で最初に発生した page_view.page_title`

各 `page_view` は、そのpage_viewが属する `session_key` の `session_landing_page` に帰属する。したがって `peakDayPageViews` は「そのLPから始まったセッション内で、peak日に発生したpage_view数」。

`peakDayLandingSessions` は「peak日にpage_viewを発生させた、そのセッションLP起点のセッション数」。セッション開始日ではなく、page_view発生日で日別比較する。

### page_location別PVとの違い

従来の `breakdowns.landingPage` は `page_view.page_location` 別PVであり、「その日にどのURLが何回見られたか」を示す。

新しい `pvSpikeDiagnostic.sessionLandingPageDiagnostic` は、「どのページから始まったセッション群が、その日のPVに寄与したか」を示す。たとえば `/` から入ったユーザーが `/blog/a` を多く閲覧した場合、page_location別PVでは `/blog/a`、セッションLPでは `/` が上位になることがある。

### fallback方針

- セッションLP SQLが失敗した場合、既存の `page_location` 別PVをfallbackとして維持
- `pvSpikeDiagnostic.caveats` に取得失敗理由の型とfallback使用を明記
- `sessionLandingPageDiagnostic` がある場合、AI promptではこれをLP原因分析の優先根拠にする
- `sessionLandingPageDiagnostic` がない場合のみ、従来の `breakdowns.landingPage` を使う

### caveats

- 一部page_viewは `ga_session_id` または `user_pseudo_id` がなく、セッションLPに帰属できない場合がある
- 一部page_viewは `page_location` がなく、セッションLPに帰属できない場合がある
- `peakDayLandingSessions` はセッション開始日ではなくpage_view発生日ベース
- GA4 BigQueryだけでは広告配信、SNS投稿、メルマガ、外部掲載の実施有無は確認できない

### テスト方針

- fixtureで `user_pseudo_id + ga_session_id` ごとの最初のpage_viewがLPになることを確認
- peak日/前日で `delta`、`deltaRate`、`shareOfPeakDayPageViews`、`contributionToIncrease` を確認
- `ga_session_id` 欠損page_viewが落ちずに `missingSessionIdPageViews` とcaveatへ入ることを確認
- セッションLP SQL失敗時に旧 `page_location` 別PVへfallbackすることを確認
- AI promptに「page_location別PVとセッションLPは別物」が入ることを確認
- フロントのAI考察カードにLP定義メタが表示され、旧回答でも落ちないことを確認

### 今回実装したファイル

- `backends/ads-insights/web/app/ai_analysis.py`
- `backends/ads-insights/web/app/backend_api.py`
- `backends/ads-insights/tests/test_ai_analysis_contract.py`
- `backends/ads-insights/tests/test_ai_analysis_live_smoke.py`
- `src/components/ai-explorer/v2/InsightTurnCard.jsx`
- `src/components/ai-explorer/v2/__tests__/InsightTurnCard.test.jsx`
- `src/pages/__tests__/AiExplorer.neutral-route.e2e.test.jsx`
- `scripts/verify-ai-explorer-route.mjs`
- `scripts/verify-ai-explorer-production.mjs`
