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
