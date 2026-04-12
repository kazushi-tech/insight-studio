# Claude Implementation Prompts

このファイルは、`stitch2` に配置した最新デザインを現在の React 実装へ反映するための、そのまま Claude に渡せる詳細プロンプトです。

## 1. 要点パック実装プロンプト

```text
このリポジトリに対して、要点パック画面を最新の Stitch2 デザインに沿って実装してください。

## 参照デザイン

- デザイン資産:
  - `stitch2/ads-pack-executive-summary/screen.png`
  - `stitch2/ads-pack-executive-summary/DESIGN.md`
  - `stitch2/ads-pack-executive-summary/code.html`

## 対象の既存実装

- `src/pages/EssentialPack.jsx`
- 必要に応じて:
  - `src/components/ads/KpiGrid.jsx`
  - `src/components/MarkdownRenderer.jsx`
  - `src/components/ui.jsx`
  - `src/index.css`

## 実装目的

現在の要点パックを、単なる Markdown 表示ではなく、「期間要約 / Executive Summary」として読める画面に置き換えること。ただし、見た目だけを移植するのではなく、既存の実データフローを維持すること。

## 絶対条件

- 既存のデータ取得フローは壊さない
  - `useAdsSetup()`
  - `reportBundle`
  - `periodReports`
  - `regenerateAdsReportBundle()`
- AI に渡す元データ構造は変更しない
- 要点パック画面は「人間向けの表示レイヤー」であり、AI の根拠データそのものにしない
- モック値は使わない
- UI 上の数値は必ず実データから算出または抽出する

## 画面要件

### ヘッダー
- ページタイトルは `期間要約`
- 補助英語は `Executive Summary` として小さく添える
- 案件名、期間レンジ、更新時刻を表示
- データ品質アラートを上段に表示
- カバレッジサマリーを表示
  - 実測 (Observed)
  - 導出 (Derived)
  - 代替 (Proxy)
  - 推論 (Inferred)

### 上段4カード
- 4カード構成を実装
  - コンバージョン率 (Observed)
  - 潜在検索需要または潜在流入機会 (Derived)
  - 離脱率 / リスク指標 (Observed, quality issue があれば注意表示)
  - 推奨アクション
- 推奨アクションカードには以下を表示
  - Based on Evidence IDs
  - 期待効果
  - 改善レンジ
  - 責任者
  - 期限
- カードに表示する値は、既存レポート本文や既存 chart context から抽出できる範囲で出す
- 値が取れない場合は無理に埋めない

### 精緻化分析セクション
- デザイン参照の 3カラム構造を実装
  - 観測事実
  - 要因仮説
  - 改善示唆
- Evidence ID を表示
- `Observed Fact` と `Inferred Insight` を混同しない
- Root Cause には `Strong Inference` や `Weak Signal` のような強度ラベルを使う
- `Verified Logic` のような強すぎる表現は使わない

### 根拠データドロワー
- 折りたたみ可能な根拠データエリアを実装
- 最低限以下を表示
  - 情報源
  - 最終同期時刻
  - Evidence ID 一覧
  - 可能なら raw value / baseline / comparison window

## 実装方針

- 既存の `splitMarkdownByTopLevelSections()` と `extractMarkdownSummary()` は活かしてよい
- ただし、ページ全体はアコーディオン主導ではなく、上部サマリー主導に再構成する
- 現在の Markdown 本文は、画面下部に詳細として残してよい
- 新規コンポーネントに分割してもよい
  - 例:
    - `EssentialPackHeader`
    - `ExecutiveSummaryCards`
    - `EvidenceInsightRow`
    - `EvidenceDrawer`

## データ意味のルール

- Observed:
  - GA4 などの直接観測値
- Derived:
  - 検索需要や click share などから導出した値
- Proxy:
  - 実測不能な概念の代替指標
- Inferred:
  - AI やルールで推論した示唆

この区分を UI 上で明確にすること。

## 禁止事項

- モック文言の固定表示
- AI の要約を再度 AI の根拠として使う構造
- 取れない値を適当に埋めること
- 因果関係を確定的に表現すること

## 完了条件

- `src/pages/EssentialPack.jsx` で新デザインが再現されている
- 既存のデータ取得と認証ガードが維持されている
- 数値カードが観測値 / 導出値 / 推論を混同していない
- 長い Markdown を読まなくても、上部だけで概要が把握できる
```

## 2. グラフ実装プロンプト

```text
このリポジトリに対して、グラフ画面を最新の Stitch2 デザインに沿って実装してください。

## 参照デザイン

- デザイン資産:
  - `stitch2/ads-graphs-final/screen.png`
  - `stitch2/ads-graphs-final/DESIGN.md`
  - `stitch2/ads-graphs-final/code.html`

## 対象の既存実装

- `src/pages/AnalysisGraphs.jsx`
- `src/components/ads/ChartGroupCard.jsx`
- 必要に応じて:
  - `src/utils/chartTypeInference.js`
  - `src/utils/adsReports.js`
  - `src/index.css`

## 実装目的

現在のグラフページを、要点パック的な summary-heavy 画面ではなく、charts-first の検証画面として再構成すること。

## 絶対条件

- 既存の `reportBundle.chartGroups` を主データ源として使う
- `getDisplayChartGroups()` / `getChartPeriodTags()` を壊さない
- Analyst View では actual chart と raw table が読めること
- モックグラフは使わない
- 要点パックの大きな推奨アクションカード構造は持ち込まない

## 画面要件

### ヘッダー
- ページタイトルは `広告考察：グラフ`
- 案件名、期間レンジ、更新時刻を表示
- `Exec View` / `Analyst View` トグルを表示
- データ品質ステータスを表示

### 上段 Top Insight cards
- 3カードまで
- 内容は簡潔に
  - CVR 4.2%
  - 推定オークション圧
  - 異常検知 / モバイル
- 各カードに以下を表示
  - metric class
  - evidence id
  - 比較差分
  - 1行 takeaway
- 推奨アクションの大カードは置かない

### テーマタブ
- `全件`
- `CV分析`
- `流入分析`
- `LP分析`
- `デバイス分析`
- `時間帯分析`
- `異常検知`

### セクション構造
- テーマごとにアコーディオン
- セクションヘッダーに表示
  - chart count
  - critical shift count
  - 品質状態
  - 主要KPI

### セクション内の構造
- まず actual charts
- 次に takeaway
- 最後に詳細データ分析テーブル
- Analyst View では以下を必須表示
  - 軸ラベル
  - 単位
  - 凡例
  - comparison window
  - raw table

### 異常検知
- `Actual vs Expected Band` を実装
- 右側に anomaly detail card を表示
  - 検出日
  - 実測値
  - 期待帯域
  - 判定根拠
  - 監視優先度
  - 確認事項または初動対応
- 金額インパクトは、算出式が明示できないなら出さない

## データ意味のルール

- Observed:
  - 実測指標
- Derived:
  - 直接観測でなく算出ロジックを通した値
- Proxy:
  - 代替指標
- Inferred:
  - AI評価や補助スコア

例えば:
- 直接集計したデバイス別CVRは Observed
- 検索需要から推計した機会は Derived
- 推定オークション圧は Proxy
- AI acquisition score のような複合補助評価は Inferred

## 実装方針

- `AnalysisGraphs.jsx` を pages-first で再構成してよい
- `ChartGroupCard.jsx` は必要なら分割してよい
- セクション単位のコンポーネントに分けてよい
  - 例:
    - `GraphTopInsights`
    - `GraphSectionHeader`
    - `GraphSectionCharts`
    - `GraphRawTable`
    - `AnomalyDetailCard`
- 現在の filter bar は、デザインに合わせて theme tabs 중심に置き換えてよい

## 禁止事項

- 要点パックの narrative-heavy 構造を流用すること
- summary card ばかりで actual chart が減ること
- Proxy を実測値のように見せること
- Analyst View で raw table に辿れないこと
- タイトルと実データの意味がズレること
  - 例: 新規/再訪構成なのに `CVイベント構成` と呼ぶ

## 完了条件

- `src/pages/AnalysisGraphs.jsx` が charts-first の画面になっている
- Analyst View で actual chart と raw table が読める
- Top cards と各セクションが対応している
- Observed / Derived / Proxy / Inferred の使い分けが UI 上で明確
- 異常検知セクションが検証画面として成立している
```

## 3. Excel取り込み統合グラフ実装プロンプト

```text
このリポジトリに対して、「広告考察：グラフ」画面へ月次レポートExcel取り込みフローを統合してください。

今回の目的は、新ATOMで作成した提出用の月次レポートExcelを Insight Studio に読み込ませ、既存の GA4 / BigQuery ベースの分析画面に、広告詳細グラフとクリエイティブ参照情報を補助データとして重ねることです。

## 参照デザイン

- デザイン資産:
  - `stitch2/stitch_ad_insights_data_integration (27)/screen.png`
  - `stitch2/stitch_ad_insights_data_integration (27)/DESIGN.md`
  - `stitch2/stitch_ad_insights_data_integration (27)/code.html`

## 対象の既存実装

- フロントエンド:
  - `src/pages/AnalysisGraphs.jsx`
  - `src/components/Layout.jsx`
  - `src/contexts/AdsSetupContext.jsx`
  - `src/api/adsInsights.js`
  - `src/utils/adsReports.js`
  - 必要に応じて:
    - `src/components/ui.jsx`
    - `src/index.css`
- バックエンド:
  - `tmp_ads_insights_repo/web/app/backend_api.py`
  - `tmp_ads_insights_repo/web/app/kpi_extractor.py`
  - `tmp_ads_insights_repo/web/app/image_extractor.py`
  - `tmp_ads_insights_repo/web/app/point_pack_generator.py`

## 実装目的

現在の `広告考察：グラフ` は、`reportBundle.chartGroups` を主データ源とする GA4 / BigQuery の検証画面になっています。

これを壊さずに、提出用の月次レポートExcelを追加入力として取り込み、以下を実現してください。

- Excel をアップロードできる
- アップロード後に抽出プレビューが見られる
- ユーザーが「反映」を押した後にだけ画面へ適用される
- 反映後は「広告詳細（Excel由来）」と「サイト回遊・流入分析（GA4 / BigQuery）」が同じ画面内で自然に共存する
- バナー画像または広告タイトルをクリエイティブ参照として表示できる
- 一部項目が未検出でも、警告つきで反映継続できる

## 絶対条件

- 既存の BigQuery ベースのデータ取得フローは壊さない
  - `useAdsSetup()`
  - `setupState`
  - `reportBundle`
  - `regenerateAdsReportBundle()`
- 既存の `reportBundle.chartGroups` は維持し、Excel由来データは overlay / 追加セクションとして扱う
- モックデータを使わない
- UI上の数値・グラフ・バナー情報は必ず実データから抽出または算出する
- PDF取り込みは今回のスコープ外
- 対応形式は `.xlsx` のみ
- 「アップロードしたら即反映」ではなく、必ず
  1. アップロード
  2. 解析プレビュー
  3. 反映
  の3段階にする
- 画面は別ページに分けず、原則 `src/pages/AnalysisGraphs.jsx` の文脈で完結させる

## 現在ある資産の扱い

今回の実装では、既存コードの以下を優先的に流用してください。

- 既存の chart bundle 生成・表示フロー
  - `src/utils/adsReports.js`
- 既存の setup / reportBundle 管理
  - `src/contexts/AdsSetupContext.jsx`
- 既存の Google Drive / xlsx ダウンロード口
  - `GET /api/gdrive/config`
  - `POST /api/gdrive/download`
  - `POST /api/gdrive/download_folder`
  - `POST /api/gdrive/process_and_generate`
  - `POST /api/gdrive/sync`
- 既存の xlsx 抽出器
  - `extract_from_excel`
  - trend / media 抽出
  - image / banner 抽出

ただし、現在の API は Google Drive 経由の xlsx 取得が中心で、ローカルファイルを直接アップロードする前提にはなっていないため、必要であれば新規エンドポイントを追加してください。

## UI要件

### ページ全体

- ベースページは `広告考察：グラフ`
- 左ナビ、ヘッダー、期間表示、既存のアプリ文脈は維持
- アップロード機能が主役になりすぎないこと
- 既存グラフ画面の中に自然に統合されていること

### 反映後のメイン構成

1. 上部ステータス帯
   - `Excelデータ反映済み`
   - 反映元ラベル: `ATOM Monthly Excel` または `ATOM月次Excel`
   - 最終更新日時
   - secondary action:
     - `再アップロード`
     - `差し替え`
     - `ログを表示`
     - `解除`

2. ページタイトル / 期間
   - タイトルは `広告考察：グラフ`
   - 補助説明は、Excel由来データとリアルタイム計測の統合分析であることを短く示す
   - 期間レンジ表示は既存スタイルに寄せる

3. 注意帯
   - 例:
     - `検索語句は未検出です。前月比でのCVR上昇は、バナー画像の影響も含めて要確認です。`
     - `一部項目は未検出ですが、他の抽出データで反映を継続しています。`
   - 断定的な原因表現は避ける
   - `推定` `要確認` `可能性` を明示する

4. 広告詳細（Excel由来）
   - セクション見出し: `広告詳細`
   - 小さな source badge: `ATOM月次Excel` または `Excel由来`
   - 最低限以下のカード / グラフを表示
     - 月別推移トレンド
     - 広告グループ別掲載結果
   - 今後追加しやすい構造にする
     - 日別推移
     - 曜日別
     - 検索語句
     - 広告別
     - キャンペーン別

5. クリエイティブリファレンス
   - セクション見出し: `クリエイティブリファレンス`
   - source badge: `Excel由来`
   - バナー画像を表示できれば画像を優先
   - 画像が取れなければ広告タイトル / 代替情報にフォールバック
   - 各カードに以下を表示できる設計にする
     - 画像 or タイトル
     - 広告名 / 訴求名
     - 補助指標（例: CTRタグ）
     - 備考 / 抽出要約

6. サイト回遊・流入分析（既存データ）
   - セクション見出し: `サイト回遊・流入分析`
   - source badge: `GA4 / BigQuery`
   - 現在の `chartGroups` ベースの graphs-first 表示を維持
   - Excel由来の広告詳細と、GA4/BQ由来の行動分析が混ざりすぎないようにする

## 状態要件

### 状態A: 未反映

- `AnalysisGraphs.jsx` 上部に小さな取り込み導線を出す
- 例:
  - `月次レポートExcelをアップロードすると、広告詳細グラフとバナー情報を反映できます`
  - 対応形式: `.xlsx`
- CTA:
  - `Excelをアップロード`
- 既存グラフは引き続き見えていること

### 状態B: 解析プレビュー

- 同じ `AnalysisGraphs.jsx` 内でインライン表示
- 背景を強くぼかしたモーダルにはしない
- 表示項目:
  - アップロード済みファイル名
  - 対象月
  - 抽出完了ステータス
  - セクション別抽出結果
    - 月別推移
    - 広告グループ別
    - バナー画像
    - 検索語句
    - その他
- ステータスは
  - `抽出成功`
  - `未検出`
  - `警告`
  を明確にする
- CTA:
  - `グラフに反映する`
  - `キャンセル / 再アップロード`

### 状態C: 反映後

- 上部ステータス帯を表示
- 広告詳細セクションと既存セクションを同居させる
- 一部未検出項目の注意帯を維持する

## データ設計要件

### 基本方針

- `reportBundle` の既存 shape は維持する
- Excel由来データは、別 bundle または merged bundle として扱ってよい
- ただし AI や既存タブが壊れないよう、既存 `reportBundle.reportMd` / `chartGroups` を不用意に上書きしない

### 推奨構造

以下のような構造を許容する実装にしてください。

- `reportBundle`
  - `source`
  - `reportMd`
  - `chartGroups`
  - `periodReports`
  - `generatedAt`
  - `excelImport`
    - `status`
    - `fileName`
    - `importedAt`
    - `warnings`
    - `sections`
    - `creativeRefs`
    - `chartGroups`

もしくは、同等の責務分離ができる構造なら別案でもよいです。

### Excelから抽出したい最低要素

- KPI:
  - cost
  - impr
  - click
  - cv
  - ctr
  - cvr
  - cpa
  - cpc
  - revenue / roas（存在する場合）
- セクション:
  - 月別推移
  - 日別推移
  - 曜日別
  - 広告グループ別
  - 検索語句（存在すれば）
  - バナー / 画像 / 広告タイトル

### source badge のルール

- `Excel由来`
- `GA4 / BigQuery`
- 必要時のみ `複合データ`

`SOURCE:` のような大きいラベルではなく、控えめな補助ラベルとして扱うこと。

## API要件

既存の Google Drive 連携を活かしてもよいし、ローカルアップロードを追加してもよいです。

必要に応じて、以下のような新規 API を追加してください。

- `POST /api/excel/upload`
  - `.xlsx` を受け取り、案件ごとの作業領域に保存
- `POST /api/excel/preview`
  - 保存済み xlsx を解析し、抽出結果サマリーを返す
- `POST /api/excel/apply`
  - 抽出結果をフロントで使える chart/report shape に変換して返す
- `DELETE /api/excel/import`
  - 現在反映中の Excel 補助データを解除する

Google Drive 経由で完結させる場合でも、フロント側では上記に相当する責務が分かる API 層に整理してください。

## フロント実装要件

### `src/api/adsInsights.js`

- Excel取り込み用 API wrapper を追加
- BQ API とは責務を分ける

### `src/contexts/AdsSetupContext.jsx`

- 案件ごとに Excel import 状態を保持できるようにする
- BQ setup state と混線させない
- ケース切り替え時に Excel import 状態も案件単位で切り替わるようにする

### `src/pages/AnalysisGraphs.jsx`

- 上部ステータス帯
- 未反映時のアップロード導線
- 解析プレビュー状態
- 反映後の Excel由来セクション
- 既存 GA4/BQ セクション
を1画面で成立させる

### 新規コンポーネント

必要なら以下のように分割してよいです。

- `ExcelImportBanner`
- `ExcelImportPreviewPanel`
- `ExcelImportStatusStrip`
- `ImportedAdDetailsSection`
- `CreativeReferenceSection`
- `SourceBadge`

## 実装方針

- まずは画面実装よりも、データフローを先に整える
- xlsx の抽出結果が UI に渡る shape を先に定義する
- その後で Stitch2 デザインを当てる
- `AnalysisGraphs.jsx` を charts-first のまま保つ
- 「アップロードUI」ではなく「補助データ反映付きグラフ画面」として仕上げる

## 禁止事項

- 別ページとして `Excel Imports` 主体の画面を作ること
- モックのグラフやダミーのバナーを使うこと
- 未検出項目を無理に埋めること
- Excel由来の推定を、GA4/BQ の実測値のように見せること
- 既存 `reportBundle` のみを前提にした画面を壊すこと
- PDFパーサを今回の主経路にすること

## 完了条件

- `広告考察：グラフ` 画面に Excel取り込みフローが統合されている
- アップロード前 / 解析プレビュー / 反映後 の3状態が成立している
- 反映後に「広告詳細（Excel由来）」と「サイト回遊・流入分析（GA4 / BigQuery）」が自然に共存している
- バナー画像または広告タイトルの参照セクションが表示される
- 一部未検出項目があっても警告付きで反映継続できる
- 既存の BQ ベース分析、AI 連携、認証ガード、案件切り替えが壊れていない
```
