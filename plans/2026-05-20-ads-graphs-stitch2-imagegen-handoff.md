# /ads/graphs グラフUI再設計 handoff - Stitch2 / GPT Image2 比較前提

作成日: 2026-05-20  
対象 repo: `C:\Users\PEM N-266\work\insight-studio`  
対象画面: `/ads/graphs`, `/ads/wizard`  
現在URL例: `http://127.0.0.1:3002/ads/graphs?verify=1779262840863`  

## 0. 結論

現セッションでは、BigQuery期間取得・選択クエリ別の実行サマリー・低サンプル/同一値判定など、データ取得と状態表示の土台は改善した。

ただし、最重要だった「グラフが広告運用者にとって見やすい画面になる」は未達。特に折れ線グラフが情報過多で、Image2モックの美しさをReact/Tailwind/SVGへ落とし込む段階で破綻している。

次セッションでは、現行ChartGroupCardの延長修正ではなく、先に要件定義とデザイン案を固定する。Stitch2とGPT Image2の両方でUI案を作り、どちらの構造が実装に向くかを比較したうえで、採用案をReact/Tailwind/SVGへ再実装する。

静的画像をそのままグラフ真実として使うのではなく、画像は構図・トンマナ・余白・情報密度の参照に使う。数値、ラベル、軸、ホバー値、表は必ずReact/HTML/SVG/Chart.js側で実データから描画する。

## 1. ユーザーからの最新フィードバック

最新スクリーンショットでは、`異常検知 — Z-score` のグラフが以下のように見えている。

- 線が多く、色・点・破線・注釈が密集している
- 右側の読み分けカードと下部の日別表があるが、全体として整理されず「カオスなグラフ」になっている
- Image2モックのような完成された構図ではなく、機能を足しただけに見える
- これ以上の微修正依頼はユーザー負担が大きい

重要な判断:

- このままChartGroupCardを少しずつ直すのは避ける
- 先に厳密な要件定義と画面設計を作る
- Stitch2とGPT Image2を比較して、実装向きの案を選ぶ
- 次セッションでは「自分で工夫する余地」を要件として明文化し、指示待ちの実装にしない

## 2. 現セッションで実装済みの主な変更

### Backend

対象:

- `backends/ads-insights/web/app/backend_api.py`
- `backends/ads-insights/web/app/bq_chart_builder.py`

実装内容:

- `/api/bq/periods`
  - `2026-05` 手動候補フォールバックを廃止
  - `PROJECT_ID.dataset.INFORMATION_SCHEMA.TABLES` から `events_YYYYMMDD` を取得
  - 失敗時のみ project-qualified `__TABLES__` を代替参照
  - 空の場合は手動候補を作らず、診断情報を返す
  - 返却情報:
    - `dataset_id`
    - `granularity`
    - `table_count`
    - `method`
    - `methods_tried`
    - `message`

- `/api/bq/generate_batch`
  - 各選択クエリの実行結果を `execution_summary` として返す
  - 返却情報:
    - `query_type`
    - `status: success | no_data | error | no_chart`
    - `row_count`
    - `chart_group_count`
    - `message`

- 直帰率LPグラフ
  - 診断カード用に `rows` を追加
  - `label`, `sessions`, `bounceSessions`, `bounceRate` を返せるようにした

### Frontend

対象:

- `src/pages/SetupWizard.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/utils/adsReports.js`
- `src/components/ads/ChartGroupCard.jsx`
- related tests

実装内容:

- `SetupWizard`
  - `FALLBACK_MONTH_PERIOD = '2026-05'` を削除
  - 期間一覧が空でも手動候補を作らない
  - 期間取得診断を表示

- `AnalysisGraphs`
  - 「選択クエリと表示期間グラフの対応」を backend `execution_summary` から表示
  - タイトル正規表現による推定を廃止方向へ
  - 古い保存データのみ chart metadata fallback

- `adsReports`
  - `pickExecutionSummary` を追加
  - report bundle に `executionSummary` を保持

- `ChartGroupCard`
  - Image2風のカードUIに寄せる試みを実装
  - 折れ線:
    - KPIカード
    - SVG線
    - 右側凡例
    - 選択中の値
    - 日別表
  - 直帰率100%:
    - 棒グラフではなく診断カード
  - 低サンプル検索:
    - 「日別トレンド化しません」を撤回
    - 「この期間の検索イベントはN件です」へ変更
    - 発生日の点表示と表を追加
  - ランキング:
    - 上位15件の読みやすい表型バーに変更

## 3. 検証済み

実行済み:

```bash
npm run lint
npm run build
npm test -- src/utils/__tests__/adsReports.test.js src/components/ads/__tests__/ChartGroupCard.test.jsx
cd backends/ads-insights
python -m pytest tests/test_bq_chart_builder_regression.py tests/test_bq_periods_and_batch_summary.py -q
```

結果:

- lint pass
- build pass
- frontend tests pass
- backend pytest pass

右カラム / browser確認:

- Vite: `127.0.0.1:3002`
- ads backend: `127.0.0.1:8001`
- `/ads/wizard` から実データ生成後、`/ads/graphs` で実データ表示を確認
- `2026-04` の実データで `表示グループ数 20` を確認
- 選択クエリ別の行数/グラフ数表示を確認

ただし、表示品質は未達。特に折れ線グラフは「機能追加の集合」になり、ユーザー確認ではカオスと判断された。

## 4. 現状の問題

### 4.1 最大の問題

デザインの完成形を先に固定せず、既存のChartGroupCardへ機能を足していったため、見た目が統合されていない。

具体例:

- KPIカード、SVGグラフ、右凡例、日別表、診断チップがそれぞれ別部品に見える
- 情報量の優先順位が弱い
- 折れ線の本数や点が多く、主役が分からない
- 注釈や選択値はあるが、読む順番が設計されていない
- 下部テーブルがグラフの理解を助けるというより、さらに密度を増やしている

### 4.2 避けるべき次の動き

- 現行 `ChartGroupCard.jsx` にさらに局所修正を積む
- 1つの巨大コンポーネントの中で全グラフ種別を処理し続ける
- Image2画像を「雰囲気」だけ見て、実装時に別物にする
- Chart.js標準UIに戻して、また凡例・軸・表が読みにくくなる
- データが少ないケースを勝手に「低サンプルだから出さない」と決める

## 5. 次セッションの進め方

### Phase 0: 現在の実装を棚卸し

目的:

- データ取得改善は残す
- カオス化した表示部分は再設計対象として扱う

確認するファイル:

- `backends/ads-insights/web/app/backend_api.py`
- `backends/ads-insights/web/app/bq_chart_builder.py`
- `src/pages/SetupWizard.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/utils/adsReports.js`
- `src/components/ads/ChartGroupCard.jsx`
- `src/components/ads/__tests__/ChartGroupCard.test.jsx`
- `src/utils/__tests__/adsReports.test.js`
- `backends/ads-insights/tests/test_bq_periods_and_batch_summary.py`

判断:

- Backend期間取得とexecution summaryは残す
- SetupWizardの手動候補撤回は残す
- ChartGroupCardの表示UIは全面再設計対象

### Phase 1: 要件定義を先に固定

対象グラフタイプを以下に分ける。

1. KPI/単一値カード
2. 日別推移
3. 複数系列日別推移
4. ランキング横棒
5. 同一値診断
6. 低サンプル検索クエリ
7. 異常検知
8. データなし/未取得/エラー

各タイプごとに決めること:

- 主メッセージ
- 最初に見る数値
- グラフにするか、表にするか、診断カードにするか
- ホバーで見せる値
- 下部表の有無
- 右側リストの有無
- データが少ない/同一/欠損時の代替表示

### Phase 2: Stitch2で構造案を作る

Stitch2は、React/Tailwindに落とし込みやすい構造案を作るために使う。

期待する出力:

- 主要カードのHTML/Tailwind構造
- 色、余白、カード密度
- グラフ周辺の情報整理
- 実装しやすいレスポンシブ構造

Stitch2に期待しないもの:

- 正確な実データグラフ描画
- Chart.js/SVGの実装そのもの
- BigQueryロジック

### Phase 3: GPT Image2で完成ビジュアル案を作る

GPT Image2は、最終画面の見た目と情報密度を判断するために使う。

期待する出力:

- 完成度の高い高 fidelity UI mock
- グラフの読みやすい構図
- 色、トンマナ、情報優先順位
- 余白や視線誘導

注意:

- 画像内の日本語・数値は信用しない
- 実データ値は必ずReact/HTML/SVG側で描画
- 画像をそのまま貼ってグラフ真実にしない

### Phase 4: Stitch2案とGPT Image2案を比較

比較軸:

- 実装しやすさ
- 広告運用者が3秒で意味を読めるか
- 数値確認しやすいか
- ホバー/表/凡例との相性
- 異常値・低サンプル・同一値に耐えるか
- PC専用画面として密度が適切か

採用方針:

- レイアウト構造はStitch2
- 視覚完成度・色・余白・グラフ表現はGPT Image2
- 最終実装はReact/Tailwind/SVG

### Phase 5: 実装

巨大な `ChartGroupCard.jsx` に全部詰め込まない。

推奨分割:

```text
src/components/ads/charts/
  AdsChartCardShell.jsx
  DailyTrendCard.jsx
  MultiSeriesTrendCard.jsx
  RankingBarTableCard.jsx
  FlatMetricDiagnosticCard.jsx
  LowSampleSearchCard.jsx
  AnomalyDetectionCard.jsx
  ChartEmptyState.jsx
  ChartTooltip.jsx
  ChartKpiStrip.jsx
  ChartLegendList.jsx

src/utils/
  chartReadability.js
  chartSeriesTransform.js
```

`ChartGroupCard.jsx` はルーティング役に寄せる。

## 6. Stitch2に投げるプロンプト

以下をそのままStitch2に投入する。

```text
Create a production-ready React + Tailwind CSS dashboard redesign for an existing Japanese SaaS analytics page.

Context:
This is Insight Studio, a PC-only advertising operations analytics dashboard. The page is /ads/graphs. It visualizes GA4 + BigQuery advertising insights. The current implementation is too chaotic: line charts contain too many overlapping series, legends are hard to read, tables add density without improving comprehension, and diagnostic states are mixed into normal chart cards.

Goal:
Redesign the graph card system so a Japanese ad operator can understand each chart in 3 seconds, then inspect exact values by hover or table. Do not create a marketing landing page. This is an operational analytics screen.

Design language:
- Botanical green primary: #003925
- Warm off-white app background: #fafaf5
- Clean SaaS dashboard
- Dense but readable
- PC desktop only
- Border radius around 12-16px
- No decorative blobs
- No hero layout
- No fake brand logos
- Avoid excessive gradients
- Use restrained botanical green, teal, muted blue, amber for warnings, warm neutral surfaces

Required components:

1. DailyTrendCard
- For LP daily sessions.
- Header: title, period, comparison condition, quality/status chip.
- KPI strip: total sessions, primary LP sessions, average sessions per LP, peak day.
- Main chart area:
  - One primary green line.
  - One comparison blue dotted line.
  - Other series as very light gray context lines.
  - Only important x-axis labels: start, weekly ticks, end, peak day.
  - Peak day annotation.
  - Hover tooltip area must be part of the structure.
- Right side list:
  - LP name, total sessions, previous-period delta.
  - Long URLs must be shortened but full value is available by title/tooltip.
- Bottom:
  - Collapsible daily values table, not always visually dominant.

2. FlatMetricDiagnosticCard
- For bounce rate where all LPs are 100%.
- Do not show a meaningless bar chart.
- Header: Landing Page Comparison (Bounce Rate), data diagnostic completed.
- KPI tiles:
  - Compared LP count
  - Bounce rate
  - Variance
  - Comparison usefulness
- Diagnosis panel:
  - Main message: all LPs have identical bounce rate, so comparison is not useful.
  - Possible causes.
  - Next actions.
- Table:
  - LP
  - sessions
  - bounce sessions
  - bounce rate
  - status

3. RankingBarTableCard
- For region / OS / LP rankings.
- Always show top 15 when available.
- Table-like horizontal bar chart.
- Columns: rank, label, horizontal bar, value, share.
- Top 3 emphasized with subtle medal/rank treatment.
- All labels visible, no axis label truncation.
- Values right aligned.

4. LowSampleSearchCard
- For search query data with small counts.
- Do not say "trend is not generated".
- Main message: this period has N search events.
- Show a compact ranking list of terms, occurrence dates, and raw counts.
- Include small occurrence dots by date.
- Include CTA-like controls for extending period and viewing raw data.
- The line chart must not be the main visual.

5. AnomalyDetectionCard
- For z-score anomaly detection.
- Must avoid chaos.
- Main message first: detected anomalies count, strongest anomaly day, metric.
- Chart should show only one selected metric at a time by default.
- Other metrics are selectable chips, not overlaid as noisy lines.
- Include a compact event table below.
- If multiple metrics exist, use tabs or segmented controls.

6. QueryExecutionSummary
- Shows selected query types and whether each produced charts.
- Use backend execution summary, not title regex inference.
- Statuses: success, no_data, no_chart, error.
- Show row_count and chart_group_count.
- This component should be compact and reassuring, not dominant.

Implementation constraints:
- Output React components with Tailwind classes.
- Use real DOM/SVG placeholders for charts, not static images.
- Do not hardcode fake data in the final architecture; sample data is okay only for the generated mock component.
- Keep exact Japanese copy editable in JSX.
- No external chart library assumptions unless necessary.

Deliverable:
Provide a React/Tailwind component mock with the above cards and a coherent layout system. The screen should look like a serious analytics tool, not a landing page.
```

## 7. GPT Image2 / Image Gen prompts

次セッションでは `imagegen` skill を使い、以下の5枚を作る。

推奨出力先:

```text
output/imagegen/ads-graphs-requirements-v2/
```

### 7.1 LP日別推移

```text
Use case: ui-mockup
Asset type: analytics dashboard chart redesign reference
Primary request: Create a high fidelity Japanese SaaS analytics chart card for GA4 advertising insights. This is a PC-only operations dashboard, not a marketing landing page.
Subject: LP daily sessions trend card. Show one primary green line clearly, one blue dotted comparison line, and remaining LP lines as very light gray context. Add peak day annotation, KPI chips, compact x-axis labels, and a right-side LP total list with shortened URL names.
Style: polished product UI, dense but readable, botanical green, teal, muted blue, warm off-white background, subtle amber for highlights.
Composition: one centered dashboard card, title and KPI strip at top, chart left, legend/list right, collapsible table hint at bottom.
Text: Japanese labels can be approximate; exact production text will be implemented in React.
Constraints: avoid crowded legends, avoid tiny date labels, no decorative blobs, no fake brand logos, no watermark, no huge hero.
```

### 7.2 直帰率100%診断

```text
Use case: ui-mockup
Asset type: analytics dashboard diagnostic card
Primary request: Create a Japanese dashboard card that replaces a meaningless bar chart when every landing page has 100% bounce rate.
Subject: Diagnostic state for all values identical. Show KPI tiles, a diagnosis panel, possible causes, next actions, and a compact LP table with sessions, bounce sessions, bounce rate, and status.
Style: professional SaaS analytics UI, botanical green and warm neutral, amber warning accents, dense but readable.
Composition: one card, header, KPI tiles, diagnosis panel, action row, lower compact table.
Constraints: do not show fake bar charts when there is no variance, no decorative illustration, no watermark, no hero.
```

### 7.3 ランキング上位15

```text
Use case: ui-mockup
Asset type: analytics dashboard ranking chart
Primary request: Design a readable top 15 ranking card for Japanese GA4 advertising analytics.
Subject: Region / OS / landing page ranking with table-like horizontal bars. Columns should include rank, label, bar, value, and share. Top 3 rows are subtly emphasized.
Style: operational SaaS dashboard, botanical green bars, warm off-white background, clean row dividers, values right aligned.
Composition: one wide card, KPI summary top, ranking table below.
Constraints: all 15 labels must be visible, no tiny axis labels, no decorative blobs, no fake brand logos, no watermark.
```

### 7.4 低サンプル検索クエリ

```text
Use case: ui-mockup
Asset type: low-sample analytics card
Primary request: Design a Japanese analytics card for search query data with very small counts. It should show the real small count without pretending there is a strong trend.
Subject: Low sample search query card. Main message says this period has N search events. Show term ranking, occurrence dates, raw counts, and small date dots. Include controls to extend period and view raw data.
Style: calm operational SaaS UI, readable and honest, botanical green, muted blue, amber caution.
Composition: one card with summary top, occurrence dot strip, ranking/table area, CTA controls.
Constraints: do not use a line chart as the main visual, do not overstate trends, no decorative blobs, no watermark.
```

### 7.5 異常検知Z-score

```text
Use case: ui-mockup
Asset type: anomaly detection analytics card
Primary request: Redesign a chaotic z-score anomaly detection chart into a readable Japanese SaaS analytics card.
Subject: Z-score anomaly detection. Show only one selected metric as the primary chart by default. Other metrics are selectable chips or tabs. The card should show anomaly count, strongest anomaly day, selected metric, and a compact event table.
Style: serious analytics dashboard, botanical green, red only for anomaly points, warm neutral surface, minimal noise.
Composition: header and KPI summary top, segmented metric selector, focused chart, right insight panel, compact anomaly event table below.
Constraints: do not overlay many noisy series, avoid dense red/orange chaos, no decorative blobs, no watermark.
```

## 8. 採用判断ルール

Stitch2案を採用する条件:

- JSX/Tailwindへそのまま落とし込みやすい
- コンポーネント分割が自然
- 実データ差し替えが簡単
- レイアウト崩れが少なそう

GPT Image2案を採用する条件:

- 見た瞬間に現行より明らかに読みやすい
- 広告運用者が「何を見るべきか」分かる
- 色と余白の完成度が高い
- 複雑な状態でも破綻しない

最終方針:

- 構造はStitch2を優先
- 視覚品質はGPT Image2を優先
- 実装はReact/Tailwind/SVGで再現
- Chart.jsは必要な箇所だけに限定

## 9. 次セッションの実装 acceptance criteria

必須:

- `/ads/wizard` で通常通り期間一覧が出る
- 期間が空の場合、手動候補を作らず原因を表示する
- `/ads/graphs` に選択クエリ別の取得結果が出る
- LP日別推移が、主線・比較線・その他文脈線に明確に分かれている
- Z-score異常検知は、複数系列を全部重ねず、1指標フォーカス + 切替にする
- 直帰率100%は棒グラフではなく診断カード
- 低サンプル検索は取得件数・発生日・表を表示
- ランキング上位15はラベルと数値が欠けない
- ホバーまたはフォーカスで値を確認できる
- 右カラムでユーザーが見て変化が分かる

禁止:

- `2026-05` の手動候補を復活させる
- データが少ないことを理由に勝手にグラフ/状態を消す
- Image2画像をそのまま静的なグラフ真実として貼る
- タイトル文字列の正規表現だけでクエリ反映状況を推定する
- nullを根拠なく0にする
- 現行のカオスな折れ線を微修正だけで済ませる

## 10. 推奨される最初の作業

1. このhandoffを読む
2. 現在の `ChartGroupCard.jsx` を確認し、表示ロジックとデータ正規化を分ける
3. Stitch2プロンプトを投げる
4. GPT Image2で5枚のUI案を生成する
5. 生成結果を並べて、採用する構造とビジュアル要素を明文化する
6. `src/components/ads/charts/` に新コンポーネント群を作る
7. `ChartGroupCard.jsx` は表示タイプのルーターに縮小する
8. 右カラムで `/ads/wizard` → `/ads/graphs` を確認する

## 11. 最後に

今回の失敗は、ユーザーの指摘通り「Image2モックを作ったのに実画面へ反映しきれていない」ことにある。

次は、先に完成UIの要件とビジュアルを固定し、実装はその再現作業として進める。  
この順序を守らない限り、また「機能は増えたが見づらい」状態になる。

