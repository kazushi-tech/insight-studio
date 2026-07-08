# 新ATOM級：Google Ads 直結＆多層レポート化 計画

## Context

インサイトスタジオを運営する当社は、代理店経由のBtoB案件とエンドクライアント直取引が混在するマーケティング系企業であり、顧客には（a）広告代理店・インハウス運用者、（b）マーケティング学習者、（c）非専門のエンドクライアントの3層が並列している。

現在の広告分析機能 [backends/ads-insights/](backends/ads-insights/) は GA4 の BigQuery export のみを見ており、Google Ads/Yahoo/Meta の広告KPI（cost/impression/click/CPA/ROAS）は未連携。運用者が管理画面からExcelをダウンロードしDrive経由で流し込む補助的な構成に留まっている（媒体判別は [kpi_extractor.py:925](backends/ads-insights/web/app/kpi_extractor.py#L925) 等のシート名マッチ止まり）。分析レポートは実装上 `gemini_client.py` が残るものの、実運用は [backend_api.py:12913 _anthropic_generate](backends/ads-insights/web/app/backend_api.py#L12913) 経由で **Claude Sonnet 4.6 に既に移行済み**。

本計画の目的は、第1弾として Google Ads を OAuth 直結で日次ETLし、Market Lens AI 側の Discovery パイプライン（`_OUTPUT_SCHEMA_CONTRACT` + 品質ゲート + 多段フォールバック）で培ったレポート資産を ads 側に移植し、**同一レポート内で読者プロファイル3種を章ごと切替できる**新ATOM級の深掘り分析を、既存SaaSの上位プランとして商材化することじゃ。

## スコープ（動かない前提）

- **媒体**: Google Ads のみ（Yahoo/Meta は後続フェーズ）
- **認証**: OAuth直結 + 日次ETL（CSV/Excelは移行期のみ並走、最終的にdeprecate）
- **LLM**: Claude Sonnet 4.6 単一軸、Gemini コードは段階的に削除
- **読者プロファイル**: 3種（代理店プロ / 学習者 / 非専門エンド）
- **UX**: 1レポート内で章ごと/展開切替、LLM呼出は1回で中間表現を返し文面はUI側で出し分け
- **商材化**: 既存「考察スタジオ」SaaS の上位プラン（テナント単位エンタイトルメント）

## 既存資産の確認済み評価

### 流用できる（新規に作り直さない）
- **Market Lens AI側**: 5章契約 [analyzer.py:1228 _OUTPUT_SCHEMA_CONTRACT](backends/market-lens-ai/web/app/analyzer.py#L1228), 多段フォールバック [discovery_pipeline.py:359 _analysis_attempts](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L359), 品質ゲート [:948-1011](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L948-L1011), 3段不確実性ラベル [analyzer.py:1312-1329](backends/market-lens-ai/web/app/analyzer.py#L1312-L1329), Section5 two-phase生成
- **ads側**: V3.9スタイル契約 [prompts/styles/hosomi_bq.txt](backends/ads-insights/web/app/prompts/styles/hosomi_bq.txt)（類推ラベル/要点パック活用/階層化箇条書き/強調方針）、システム共通ルール [prompts/system_bq.txt](backends/ads-insights/web/app/prompts/system_bq.txt)（`insight-meta` JSONフェンス契約を含む）、KPI日本語正規表現 [gemini_client.py:31-](backends/ads-insights/web/app/gemini_client.py#L31), 派生KPI算出 [report_data.py:66 compute_derived_kpis](backends/ads-insights/web/app/report_data.py#L66)、プロバイダルーティング [backend_api.py:13076](backends/ads-insights/web/app/backend_api.py#L13076)
- **フロント**: TOC+IntersectionObserver [ReportViewV2.jsx:38](src/components/report/v2/ReportViewV2.jsx#L38), [PriorityActionHeroV2.jsx](src/components/report/v2/PriorityActionHeroV2.jsx), [ConfidencePill.jsx](src/components/report/ConfidencePill.jsx), [PrintButton.jsx](src/components/report/PrintButton.jsx), Chart.js汎用カード [ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx), 期間/テーマ/ビュー切替 [AnalysisGraphs.jsx:456](src/pages/AnalysisGraphs.jsx#L456)

### 新規／改修が必要
- Google Ads API 連携レイヤー（OAuth2、developer_token申請、リフレッシュトークン暗号保管）
- 広告KPI用 BigQuery スキーマ（媒体横断を見越した正規化）
- Chart.js 拡張: heatmap / funnel / stacked_bar / 期間diff
- 読者プロファイル×2 新規スタイル（学習者／非専門）と品質ゲート拡張
- [AnalysisGraphs.jsx](src/pages/AnalysisGraphs.jsx) / [EssentialPack.jsx](src/pages/EssentialPack.jsx) / [Dashboard.jsx](src/pages/Dashboard.jsx) のダークモード対応（現状 `dark:` クラスは2〜4件のみ）

## フェーズ計画

### Phase 0: 土台整理（2〜3週）
**目的**: LLM層をClaude単一化し、プロファイル切替とプラットフォーム拡張の受け皿を作る。
- `backends/ads-insights/web/app/ads_claude_client.py` を新設し、[_anthropic_generate](backends/ads-insights/web/app/backend_api.py#L12913) の呼び出しを集約
- [gemini_client.py](backends/ads-insights/web/app/gemini_client.py) の KPI 語彙・PII スクリーニング関数を `kpi_vocab.py` へ抽出、LLM生成部は deprecated マーク
- [.env.example](backends/ads-insights/.env.example) 更新（`ANTHROPIC_API_KEY` 必須、`ANALYSIS_MODEL=claude-sonnet-4-6` デフォルト、`GEMINI_*` は移行フラグのみ）
- [prompts/system_bq.txt](backends/ads-insights/web/app/prompts/system_bq.txt) からプロファイル横断のコア品質方針を `prompts/system_common.md` に切り出し、プロファイル層はそれを継承する二層構造へ
- [hosomi_bq.txt](backends/ads-insights/web/app/prompts/styles/hosomi_bq.txt) を `styles/agency_pro_bq.md` にリネーム（または並走）、`hosomi.txt` は「deprecated」ヘッダ追加

**検証**: `pytest` で既存テストが全通、UI の AI Explorer / AnalysisGraphs が Claude で回帰なく動作。

### Phase 1: Google Ads OAuth & BQ 広告KPI基盤（4〜6週）
**目的**: Google Ads API 経由で広告KPI が日次にBigQueryへ着地する。
- **前提条件**: Google Ads API Basic Access 申請（developer_token、2〜3週リードタイム）を Phase 0 着手と同時に申請
- `google-ads` Python SDK を [requirements.txt](backends/ads-insights/requirements.txt) に追加、`web/app/google_ads_oauth.py` に OAuth2 web flow 実装
- MCC 配下の個別アカウント選択UIを [SetupWizard.jsx](src/pages/SetupWizard.jsx) に追加、リフレッシュトークンは **Postgres に AES 暗号文保存**（鍵は Render Secret Files）
- **ETL 戦略**: Google Ads Data Transfer Service を第一候補（Render 側に負荷なし）、不足粒度（アセット性能等）のみ GCP Cloud Scheduler + Cloud Function で補完。Render Starter の spin-down を避けるため ETL は GCP 側で完結
- **BQ スキーマ（新設）**:
  - `fact_ads_daily(date, platform, account_id, campaign_id, ad_group_id, ad_id, device, network, geo_target_id, impressions, clicks, cost_micros, conversions, conversion_value, all_conversions)`
  - `dim_campaign`, `dim_ad_group`, `dim_ad`, `dim_keyword`
  - GA4 と JOIN できる共通 dimension 層（`dim_date`, `dim_device`, `dim_geo`）
- [bq/queries.py](backends/ads-insights/bq/queries.py) に広告KPIクエリ追加（`ads_overview` / `ads_campaign_detail` / `ads_time_hourly` / `ads_device_geo`）
- [bq/reporter.py](backends/ads-insights/bq/reporter.py) の `auction_proxy`（現状はGA4推定値）を Google Ads 実データに差し替え

**検証**: OAuth接続→ETL→BQ反映の冪等性テスト。ベータアカウント1件で7日分連続取り込み、欠損/重複ゼロ確認。

### Phase 2: チャート・フロントUI拡張（3〜4週）
**目的**: 媒体横断／期間比較／ドリルダウンが使える。
- `src/components/ads/CrossChannelChart.jsx` / `FunnelChart.jsx` / `HeatmapChart.jsx` 新設
- Chart.js プラグイン導入（`chart.js-chart-matrix` 等、Recharts 導入は保守コスト理由で見送り）
- 期間比較: [src/utils/adsReports.js](src/utils/adsReports.js) に `getPeriodDiffGroups()` を追加、2期間同時返却
- ドリルダウン: [ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx) に `onDrilldown` prop、状態は親で管理
- [AnalysisGraphs.jsx](src/pages/AnalysisGraphs.jsx) / [EssentialPack.jsx](src/pages/EssentialPack.jsx) / [Dashboard.jsx](src/pages/Dashboard.jsx) のダークモード一括対応（Discovery側 [:discovery_jsx](src/pages/Discovery.jsx) の `dark:` 流儀を参考）

**検証**: `webapp-testing` skill（Playwright）で各新規チャート・期間比較・ドリルダウン・ダークモード確認。

### Phase 3: 新ATOM級レポート生成（4〜6週）
**目的**: 5章契約で読者プロファイル3種を1回のLLM呼出で生成する中間表現を確立。
- **共通レポート基盤を切り出し**: `backends/shared/report_framework/` 新設
  - `schema_contract.py`（`_OUTPUT_SCHEMA_CONTRACT` の汎用化）
  - `retry_ladder.py`（`_analysis_attempts` 構造の汎用化）
  - `quality_gate.py`（章欠損・末尾欠け・表未閉じ・【類推】ラベル必須箇所検出）
- **ads向け5章契約（新規）**:
  1. エグゼクティブサマリー（前期比 + 主要変動 + 最優先アクション3本）
  2. 媒体・キャンペーン横断 KPI 俯瞰
  3. 要因分解（費用・CV・ROASの変動寄与）
  4. 異常検知・外れ値（Z-score、閾値超過）
  5. 次期アクション（施策・予算配分・検証KPI）
- **中間表現JSON**: 1回のLLM生成で `{ section_id, fact_block, confidence_label, agency_pro_md, learner_md, endclient_md }` を各章ぶん返す。UI側で `profile` に応じて描画分岐
- **プロファイル別スタイル新設**:
  - `prompts/styles/agency_pro.md`（既存 hosomi_bq 継承、当たり前の数字報告を禁止、仮説思考、断定的語尾）
  - `prompts/styles/learner.md`（各章冒頭に「このKPIが重要な理由」ミニ解説、語尾丁寧、用語の初出では括弧で和訳）
  - `prompts/styles/endclient.md`（結論ファースト、アクション2〜3本に絞る、専門用語回避、グラフへの言及で補強）
- **品質ゲート拡張**: プロファイル別禁止語チェック（endclient で "CPA"/"CVR" 略語未説明は警告）、【類推】ラベル必須箇所のカバレッジ、`insight-meta` JSONフェンスの整合

**検証**: ベータ3案件で3プロファイル比較、代理店担当／学習者／非専門それぞれに読んでもらい読みやすさ評価。品質ゲート回帰テスト `pytest tests/test_quality_gate_ads.py`。

### Phase 4: 3プロファイル UX と上位プラン化（3〜4週）
**目的**: レポート内で章ごと/全体プロファイル切替ができ、上位プランで閲覧制御される。
- [ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx) に `ProfileToggle` 統合、章ヘッダに `profile pill`（プロ/学習/簡易）
- URLクエリで永続化（`?profile=agency`）、章単位の切替もサポート
- テナントエンタイトルメント: Postgres migration で `tenants.plan` 列追加、FastAPI に `require_premium` デコレータ
- `src/components/ui/PremiumBanner.jsx` で既存ユーザーへの誘導
- `PrintButton` を ads 系レポートに移植、3プロファイル分のPDF出力対応

**検証**: `webapp-testing` skill で上位プランゲート（未契約で401、契約済みで閲覧可）、プロファイル切替永続化、印刷プレビュー。

### Phase 5: 品質検証・ベータ展開（2〜3週）
- `pytest` 回帰: OAuth接続、ETL冪等性、BQスキーマ整合、品質ゲート
- Playwright (`webapp-testing` skill): プロファイル切替×期間比較×ダークモード×上位プランゲートのマトリクステスト
- `codex-review` skill: 各フェーズ完了時の品質ゲート実施
- ベータ案件3件（代理店経由2 + エンド直1）、学習者1名に fit & finish 確認

## クリティカル改修ファイル

**Backend**
- 新設: `backends/ads-insights/web/app/ads_claude_client.py`, `google_ads_oauth.py`, `google_ads_etl.py`, `kpi_vocab.py`, `prompts/system_common.md`, `prompts/styles/{agency_pro,agency_pro_bq,learner,endclient}.md`
- 新設: `backends/shared/report_framework/{schema_contract,retry_ladder,quality_gate}.py`
- 改修: [bq/queries.py](backends/ads-insights/bq/queries.py), [bq/reporter.py](backends/ads-insights/bq/reporter.py), [web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py)（上位プランゲート/プロファイル切替EP）, [web/app/report_data.py](backends/ads-insights/web/app/report_data.py)（広告KPI拡張）, [.env.example](backends/ads-insights/.env.example), [requirements.txt](backends/ads-insights/requirements.txt)
- 段階的廃止: [web/app/gemini_client.py](backends/ads-insights/web/app/gemini_client.py)（KPI vocabのみ抽出後、LLM部をdeprecate）

**Frontend**
- 新設: `src/components/ads/{CrossChannelChart,FunnelChart,HeatmapChart}.jsx`, `src/components/report/ProfileToggle.jsx`, `src/components/ui/PremiumBanner.jsx`
- 改修: [src/components/ads/ChartGroupCard.jsx](src/components/ads/ChartGroupCard.jsx)（onDrilldown/期間比較）, [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx)（プロファイル統合）, [src/pages/AnalysisGraphs.jsx](src/pages/AnalysisGraphs.jsx) / [EssentialPack.jsx](src/pages/EssentialPack.jsx) / [Dashboard.jsx](src/pages/Dashboard.jsx)（ダーク+拡張）, [src/utils/adsReports.js](src/utils/adsReports.js)（`getPeriodDiffGroups`）
- 改修: [src/pages/SetupWizard.jsx](src/pages/SetupWizard.jsx)（MCC配下アカウント選択UI）

**Infra**
- 新設: GCP Cloud Scheduler + Cloud Function（日次ETL補完用）、BQ テーブル `fact_ads_daily` / `dim_*`
- 改修: Render Secret Files（KMS鍵）、Postgres migration（`tenants.plan`, `google_ads_oauth_tokens` 暗号文列）、`render.yaml` で ETL スケジューラは定義せず GCP 側で完結

## リスクと軽減策

| リスク | 軽減策 |
|---|---|
| Google Ads Basic Access 申請が2〜3週遅延 | Phase 0 着手と同時に申請、MCC は既存の社内テストアカウントで先行検証 |
| Render Starter (512MB/Shared CPU) で日次ETL不可 | ETLはGCP側で完結、Renderは API のみ。spin-downの影響を避ける |
| 3プロファイル同時生成でLLMコスト増 | 「1回の呼出で中間表現JSONを返す」設計によりコンテキスト重複を抑制、Opusは使わずSonnet4.6単一 |
| hosomi系「事実のみ記述禁止」ルールが endclient に不適合 | `system_common.md` のコア方針からこのルールを分離、プロファイル層で上書き許可 |
| リフレッシュトークン漏洩 | AES暗号文をDB保存、鍵はRender Secret Files、アクセスは監査ログに記録 |
| SaaS上位プラン化で既存ユーザー反発 | 既存プランの機能は全て維持、新機能のみゲート。Phase 5ベータで価格感を検証 |
| 品質ゲートが3プロファイルで過剰警告 | プロファイル別に禁止語/必須ラベルを個別定義、初期閾値は緩めで運用調整 |

## 検証方法

**Backend**
```bash
cd backends/ads-insights
python -m pytest tests/test_google_ads_oauth.py tests/test_ads_etl.py tests/test_quality_gate_ads.py tests/test_profile_gating.py
```

**Frontend (`webapp-testing` skill via Playwright sync API)**
- [AnalysisGraphs.jsx](src/pages/AnalysisGraphs.jsx): 期間比較ON/OFF × プロファイル3種 × ダーク、全チャート表示確認
- [Dashboard.jsx](src/pages/Dashboard.jsx): 媒体横断KPI、ドリルダウン、ダーク
- [EssentialPack.jsx](src/pages/EssentialPack.jsx): 印刷プレビューで3プロファイル分のPDF生成
- 上位プランゲート: 未契約ユーザーで `PremiumBanner` 表示、契約後解除

**E2E ベータ**
- 代理店経由2件（agency_proプロファイル主利用、仮説思考が期待通りか）
- エンド直1件（endclientプロファイル主利用、アクションが実行可能か）
- 学習者1名（learnerプロファイルで用語解説の質を確認）

## ROI・売上インパクト

現在の「Excel読んでClaudeが要約を返すSaaS」から、**Google Ads直結＋5章契約×3プロファイルの上位プラン**に昇格することで、売上が三層構造で押し上がる。単なるARPU増ではなく、**ARPU × (1/解約率) × 顧客母数**の三因子すべてに効くのが本施策の本質じゃ。

### 1. ARPU（単価）: 2〜5倍レンジ

- **連携なし**: 「Excel読んで要約を返すアシスタント」評価 → SMB向け月額1〜3万円帯から抜け出せない
- **連携あり＋ATOM級**: 「アナリスト工数を月数十時間削減する分析基盤」評価 → 月額10〜30万円帯（ミッドマーケット）に乗る
- **決定的な違い**: 顧客が払う理由が「時短」から「意思決定品質」に変わる。決裁ラインが現場担当 → 運用責任者 → 経営層と上がり、予算枠自体が別物になる

### 2. LTV（継続期間）: 解約率が半分〜1/3に

- **連携なし**: 乗り換えコストがほぼゼロ。毎月Excelを渡すだけなので、他ツールに移っても同じ運用ができる → 解約ハードルが低い
- **連携あり**: OAuth接続・日次ETL・BQ蓄積ヒストリカル・カスタムダッシュボードが全部**スイッチングコスト**になる → 解約率が半分〜1/3に落ちる
- SaaSのLTV = ARPU × 1/解約率 で決まるため、**チャーン低下の寄与はARPU向上と同じくらい大きい**。ここが実は一番効く

### 3. 顧客母数（TAM）: 3プロファイルで商機を拡大

- **連携なしのまま**: ユーザー像は「広告運用のExcelを扱える運用担当者」に限られる。代理店の運用部／社内運用チーム以外に売れない
- **連携あり＋プロファイル分け**: 非専門エンドクライアントへの直取引が成立。代理店経由案件でも「運用者 = 代理店プロ画面／クライアント報告 = endclient画面」と使い分けでき、**契約主体が代理店＋エンドの二層で同時に獲れる**
- 当社が代理店経由とエンド直取引を併存させている構造に対し、**連携なしでは両方に同じ武器で行けない**のが最大の機会損失

### 連携なしのままの「見えない天井」

- **営業の物語が貧弱**: 「効率化ツール」という競合ひしめくカテゴリから出られない
- **クロスセル起点が持てない**: Google Adsデータがあれば「Meta広告もやりませんか」と提案できるが、なければ根拠もない
- **紹介営業が効かない**: データ連携型SaaSは顧客間で話題になるが、Excelツールは話題にならない
- **信頼感の不足**: 月末Excel頼みだと「データ遅延・欠損」が解約理由に直結、API直結はその言い訳が消える

### コスト増と粗利率

- LLMコスト: Claude Sonnet 4.6 × 月次レポート × 3プロファイル分（1レポート5〜15円相当、月次集中なら数千〜万円/案件）
- GCP / Render: Data Transfer、BigQueryクエリ、Cloud Scheduler、Secret Files で月数千〜1万円/テナント程度
- 開発人件費: 本計画5フェーズ・4〜6ヶ月で初期投資
- **粗利率の見方**: ARPUが 1〜3万円 → 10〜30万円（約10倍）に対し、変動コスト増は数千〜1万円/月程度。**粗利率は連携後の方が確実に高い**

### 契約主体・営業物語の三方向射程

| 対象 | 営業メッセージ |
| --- | --- |
| 代理店・インハウス運用部 | 「アナリスト1名分の工数削減、agency_proプロファイルで仮説思考まで支援」 |
| エンドクライアント（直取引） | 「代理店からのレポートを自分で解釈できる、endclientプロファイルで結論ファースト」 |
| マーケティング学習者 | 「実データで KPI の意味と解釈を同じ画面で学べる、learnerプロファイルで用語解説付き」 |

### 売上目標の試算（参考値）

- 既存考察スタジオ ARPU: 月額1〜3万円 × N社
- 上位プラン移行後 ARPU: 月額10〜30万円 × 30〜50%のアップグレード率
- 新規獲得（エンド直・学習者含む）: TAM 2〜3倍想定
- 解約率低下: 年間 1.5〜2倍の LTV 改善
- **実効的な売上インパクト**: 既存ベースの3〜6倍（1年後達成想定、3年後はさらに拡大余地）

この数字は本計画の実行結果に依存するため、Phase 5 のベータ3案件で ACV・解約意向・アップグレード率を実測し、全社展開前に再キャリブレーションする前提じゃ。

## 営業戦略・パッケージング

### 大原則: 新ATOMは「殺さず」「乗り合う」

現実として、本計画が完了しても新ATOMを完全置換できる機能幅には届かぬ。そして**顧客は既存ツールを捨てる意思決定を嫌う**。従って営業ポジションは「ATOM代替」ではなく「**ATOMの数字に意味を与える考察レイヤー**」として設計する。これで導入ハードル激減・稟議通過率向上・既存ATOM決裁者の顔も立つ三方良しじゃ。

| ツール | 得意領域 |
| --- | --- |
| 新ATOM | 数字の取りまとめ・定型レポート・実績ダッシュボード |
| インサイトスタジオ | 「なぜ」「次どう動くか」の考察、競合分析、LP比較、バナー分析、読者プロファイル別表現 |

### 既存100案件のセグメンテーション

100案件を十把一絡げにせず3層に分解し、価値提案を変える:

| セグメント | 想定数 | 中核価値 | 主利用プロファイル |
| --- | --- | --- | --- |
| 代理店経由（運用担当がATOM併用） | 60〜70件 | アナリスト工数削減・代理店提案力向上 | agency_pro |
| エンドクライアント直取引 | 20〜30件 | 代理店レポートを自分で読み解ける・意思決定スピード | endclient |
| 学習者・小規模インハウス | 残り | KPIの意味を実データで学ぶ教材 | learner |

### 3階層パッケージング

LP比較・バナー分析・競合分析は**Pro以上限定**で出し惜しみし、アップセル経路を確保する。全部 Pro に入れると単価が伸びず勿体ない。

| プラン | 想定ARPU | 機能 | 主ターゲット |
| --- | --- | --- | --- |
| Essential（既存継続） | 月額1〜3万円 | Excel取込+考察スタジオ+AI Explorer | 中小インハウス・学習者 |
| Pro（新・メイン商材） | 月額10〜20万円 | + Google Ads連携、5章ATOM級レポート、3プロファイル切替、期間比較、ドリルダウン | 代理店・ミッドマーケット |
| Enterprise | 月額30万円〜 | + 競合分析、LP比較、バナー分析、カスタムスタイル、専用SLA | 大手代理店・大型エンド直案件 |

### 展開シーケンス: Land and Expand（既存顧客起点）

新規営業より既存顧客からのアップセルが圧倒的に効率が高い。既存100案件を段階的に Pro へ引き上げ、ケーススタディを作ってから新規に打って出る。

1. **Phase 5 ベータ3案件**（代理店経由2 + エンド直1）で実運用検証
2. ベータ結果をケーススタディ化（アナリスト工数削減時間・提案採用率・LP改善成果）
3. 残り97案件に**3ヶ月無料トライアル**で Pro を提供、30〜50%の移行率を目標
4. 移行しない案件は Essential に残す（解約させない、**収益の取りこぼしゼロ**）
5. 新規営業はケーススタディを持って代理店経由の紹介獲得ルートへ

### 差別化3兵器の位置づけ

ATOMには無い領域を商材の切り札として配置する。バナー分析と競合分析は Market Lens AI の `build_deep_comparison_prompt`（[analyzer.py:1251](backends/market-lens-ai/web/app/analyzer.py#L1251)）の基盤を流用できるので、ads側に接続するだけで低コスト追加可能じゃ。

| 機能 | プラン | 営業での使い所 |
| --- | --- | --- |
| 競合広告投資推定 | Enterprise | 「競合はいくら使っているか」を示し、予算交渉の根拠に |
| LP比較 | Enterprise | 「勝っているLP」を可視化し、改修提案のタネに |
| バナー分析 | Pro + Enterprise | クリエイティブ提案の合理化、代理店の制作部門との連携 |

### 値付けと既存顧客フリクション抑制

- **既存顧客への値上げは行わない**。既存プランの機能はそのまま維持
- 新機能は**追加オプション**または上位プランでのみ提供
- アップグレード時の初月は割引（導入障壁を下げる）
- 年間契約割引 2 ヶ月分（キャッシュフロー先行化）

### 営業資料として出す KPI（ケーススタディ用）

ベータ3案件でこれらを実測し、残り97案件への営業資料にする:

- アナリスト1案件あたりの月次レポート作成時間（before/after）
- 代理店→クライアントへの施策提案採用率
- LP改修による CVR 変化（LP比較機能の費用対効果）
- エンドクライアントの「次アクション自己判断率」（endclientプロファイルの効果測定）

## 今回の提案で取らない選択肢

- **Yahoo / Meta 同時連携**: 認証・スキーマ統合の複雑度が2〜3倍、まず Google で商材化の手応えを確認してから
- **CSV/Excel フロー完全廃止**: 移行期は OAuth と並走（切替猶予3ヶ月）、初期から完全廃止は既存顧客離反リスク
- **代理店向け BtoB ツールへの商材転換**: 既存SaaS上位プラン化に留める（ユーザー指示）
- **4種以上の読者プロファイル**: プロンプト保守・LLMコスト・UI複雑度の観点で3種がバランス点
- **Gemini 並走維持**: 実運用は Claude のため保守コスト削減で段階的削除
- **Opus 4.7 常用**: 月次レポートでは効くがライト用途でコスト超過、Sonnet 4.6 単一で回す
