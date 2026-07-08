# `/ads/graphs` グラフUI/UX再設計 handoff

作成日: 2026-05-20
対象 repo: `C:\Users\PEM N-266\work\insight-studio`
対象画面: `/ads/graphs`

## 背景

広告グラフ画面は、直近で「表示している数値の意味を正しく読む」方向にかなり修正済みです。ただし、まだユーザー視点ではグラフ自体が見づらく、特に日別折れ線・直帰率ランキング・低サンプル検索クエリの見せ方に根本課題があります。

今回の次セッションでは、既存の正確性修正を壊さず、グラフの読みやすさを大きく作り直してください。ユーザーは「グラフは Image Gen skill / GPT Image2 で複数枚全部再作成してほしい」と希望しています。

重要: 実データの最終描画を生成画像だけに置き換えると、数値・ラベル・軸が崩れるリスクがあります。GPT Image2 はまず「望ましいグラフUIのビジュアル案・モック作成」に使い、採用案を Chart.js / HTML UI に落とし込むのが安全です。どうしても静的画像として使う場合も、実データ値・ラベルはReact側のDOM/Chart.jsで重ねるか、生成画像は背景/レイアウト参照に留めてください。

## これまでに実装済み

### PR #119: 広告グラフ正確性修正

URL: `https://github.com/kazushi-tech/insight-studio/pull/119`

主な内容:
- Backend chart metadata を追加
- `coverageLabel`, `limit`, `actualCount`, `sourceRowCount`, `warnings` を返す
- `Top 20` 固定表記をやめ、実件数ベースの `上位3件 / 最大20件` に変更
- 低サンプル `low_sample`、ラベル欠損 `missing_label` を表示
- Frontend で `labels.length` と `dataset.data.length` 不一致を検出
- 短い data は `null` 埋め、長い data は余剰検出
- Python集計グラフをページ上部へ移動
- グラフ外枠を通常カードへ戻す
- 生データテーブルの空欄を `欠損` / `算出不可` / `データなし` に整理

### PR #120: `上位5件` 表記の意味を明確化

URL: `https://github.com/kazushi-tech/insight-studio/pull/120`

主な内容:
- `LP分析 — 日別推移（上位5件 / 最大5件）` を `LP分析 — セッション数上位5LPの日別推移` に変更
- チップに `セッション数上位5LPを表示`
- 補足チップに `実数: 上位5件 / 最大5件`
- 検索クエリ・流入チャネルの日別推移も同様に具体化

### PR #121: ▼位置統一とランキング表記改善

URL: `https://github.com/kazushi-tech/insight-studio/pull/121`
merge commit: `9a078a22fbeb11da92d670b76aa875ab1e31e519`

主な内容:
- テーマ見出しの▼を左から右へ移動
- `検索クエリ — 上位3件 / 最大20件` を `検索クエリ — 検索回数上位3語` へ変更
- `ユーザー属性 — 地域別（上位15件 / 最大15件）` を `ユーザー属性 — セッション数上位15地域` へ変更
- 横棒グラフは Chart.js の自動間引きを止め、最大15件なら15件分のラベルを出す
- 横棒ランキングは件数に応じてグラフ高さを自動拡張
- master CI と post-deploy-health pass

## 現在のユーザー指摘

添付スクリーンショットから、次の課題が残っています。

### 1. 日別折れ線グラフが見づらい

例:
- `LP分析 — セッション数上位5LPの日別推移`

問題:
- 5系列が重なり、凡例も長く、どの線が何を意味するか追いづらい
- 日付ラベルが詰まりすぎている
- 色の差はあるが、主要系列以外がノイズ化している
- 「何日にセッション数が多いか」は分かるが、比較・洞察に向いていない

改善方向:
- 上位1-2系列を主役にし、残りは薄い線または `その他上位LP` にまとめる
- デフォルトは「合計推移 + 上位1LP + 前日/平均との差」程度に絞る
- 5系列比較は開閉式の詳細ビューへ移す
- 日付軸は全日表示ではなく、週次目盛り・重要日ラベル・ピークラベルにする
- 長いURL凡例はカード下部ではなく右側のリストまたはツールチップに逃がす

### 2. 直帰率が全部100%なら、横棒比較の意味が薄い

例:
- `LP分析 — 直帰率上位20LP`

問題:
- すべて100%だと比較グラフとしての情報量がない
- `最大 100 / 最小 100 / 差分 0` なら、横棒20本を並べるより「差がない」「計測仕様を確認すべき」が主メッセージ
- 100%が本当に広告運用上の問題なのか、GA4の定義/取得ロジック/サンプル都合なのかを分ける必要がある

改善方向:
- 全値同一、または分散が極端に小さい場合は棒グラフを描かない
- 代わりに `比較差なし` / `全20LPが100%` / `直帰率の取得定義を確認` の診断カードを表示
- 詳細はテーブルで表示し、棒グラフは「差がある時だけ」表示
- `直帰率` は `engagement` や `avg_pages_per_session` と合わせた品質カードにする

### 3. 検索クエリ上位3語の日別推移は少なすぎる

例:
- `検索クエリ — 検索回数上位3語の日別推移`

問題:
- 実数が最大2程度で、折れ線にする意味が薄い
- 2日程度の点を結ぶだけなので、トレンドに見えてしまうが統計的には弱い
- `低サンプル` は出ているが、グラフ自体が洞察を過大に見せている

改善方向:
- `actualCount < 5` または最大値が小さい場合は、日別折れ線を出さない
- `低サンプル: グラフ化より一覧確認が適切` の空/注意状態へ切り替える
- 検索クエリは棒グラフ + 発生日テーブルの方がよい
- 期間拡張ボタンまたは「全期間まとめで確認」を促す

## 次セッションのゴール

`/ads/graphs` のグラフを、正確性を維持したまま「広告運用者が読むべき形」に再設計する。

完成イメージ:
- 折れ線は少数系列に絞り、ピーク・変化・比較対象が一目で分かる
- 同一値/低分散のランキングは、無意味な棒グラフではなく診断カードに変換
- 低サンプルの検索クエリは、トレンドグラフではなく低サンプル表示 + 表で確認
- ユーザーが必要なグラフだけ展開できる
- グラフタイトル、チップ、図、凡例、テーブルが同じ意味を指す

## GPT Image2 / Image Gen skill の使い方

ユーザー希望により、次セッションでは Image Gen skill を使って複数のグラフUI案を作ること。

ただし、以下を守る:
- GPT Image2 の出力をそのままデータ可視化の真実として使わない
- 生成画像は「UI方向性・見やすい構図・カードレイアウト」の参照に使う
- 最終実装は `ChartGroupCard.jsx` / Chart.js / HTML で再現する
- 画像内の日本語や数値は崩れる可能性があるので、正確な文字はReact側で描画する

推奨出力先:
- `output/imagegen/ads-graphs-redesign/`

生成すべきモック:
1. `lp-daily-trend-focus.png`
   - LP日別推移の改善案
   - 主役1-2本、その他は薄く、ピーク日を強調
   - 長いURLは右側リストまたは短縮名

2. `lp-bounce-flat-diagnostic.png`
   - 直帰率が全LP 100%のときの代替表示
   - 棒グラフではなく診断カード + テーブル
   - `比較差なし`、`計測定義確認`、`補助指標を見る` の導線

3. `search-low-sample-state.png`
   - 検索クエリ上位3語・最大値2の低サンプル状態
   - 折れ線ではなく、低サンプル注意 + 発生日一覧 + 期間拡張CTA

4. `ranking-top15-readable.png`
   - 地域/OS/LPランキング上位15の読みやすい横棒案
   - ラベルが全部見える、数値が右に揃う、上位3だけ強調

5. `graph-card-collapsed-expanded-system.png`
   - 開閉式グラフカードの全体ルール
   - 閉じた状態で何が分かるか、開いた状態で何を見るか

Image Gen prompt例:

```text
Use case: ui-mockup
Asset type: analytics dashboard chart redesign reference
Primary request: Redesign a Japanese SaaS analytics chart card for GA4 advertising insights. The chart must be much easier to read than a crowded multi-line graph.
Scene/backdrop: desktop SaaS dashboard screen, warm off-white background, botanical green accents.
Subject: LP daily sessions trend card. Show one primary line clearly, one comparison line, and remaining series as muted context. Add peak day annotation, compact KPI chips, and a right-side legend list with shortened LP names.
Style/medium: polished product UI mockup, high fidelity, clean data visualization.
Composition/framing: single chart card centered, no marketing hero, no decorative blobs.
Color palette: botanical green, teal, muted blue, warm neutral surface, minimal accent amber.
Text: Japanese UI labels can be approximate; exact production text will be implemented in React.
Constraints: prioritize readability, avoid crowded legends, avoid tiny date labels, avoid excessive gradients, no fake brand logos, no watermark.
```

```text
Use case: ui-mockup
Asset type: analytics dashboard diagnostic card
Primary request: Create a Japanese dashboard card that replaces a meaningless bar chart when all landing pages have 100% bounce rate.
Subject: Diagnostic state for "all values identical". Show a clear status card, summary chips, small table, and next-action buttons. The message should communicate that comparison is not useful because every LP has the same value.
Style/medium: professional SaaS analytics UI, dense but readable.
Composition/framing: one card, top summary, middle diagnosis, lower compact table.
Constraints: no huge hero, no decorative illustration, no fake chart bars if there is no variance, no watermark.
```

```text
Use case: ui-mockup
Asset type: low-sample analytics chart replacement
Primary request: Design a Japanese analytics card for search query data with only 3 terms and very low counts. It should not pretend there is a meaningful trend.
Subject: Low sample state with small ranking list, occurrence dates, warning chip, and CTA to extend period or inspect raw data.
Style/medium: calm operational SaaS UI.
Constraints: do not use a line chart as the main visual, avoid overstating trends, keep exact numbers as placeholders only.
```

## 実装対象ファイル

主に触るファイル:
- `src/components/ads/ChartGroupCard.jsx`
- `src/utils/adsReports.js`
- `src/pages/AnalysisGraphs.jsx`
- `backends/ads-insights/web/app/bq_chart_builder.py`
- `src/components/ads/__tests__/ChartGroupCard.test.jsx`
- `src/utils/__tests__/adsReports.test.js`
- `backends/ads-insights/tests/test_bq_chart_builder_regression.py`

必要なら新規追加:
- `src/utils/chartReadability.js`
- `src/components/ads/ChartDiagnosticCard.jsx`
- `src/components/ads/ChartLegendList.jsx`
- `src/components/ads/LowSampleChartState.jsx`

## 実装計画

### Phase 1: 現状分類ロジックを追加

`normalizeChartGroupShape` か新規 `chartReadability.js` で以下を判定:
- `isLowSample`
- `isFlatSeries`
- `hasTooManyLineSeries`
- `hasTooManyXAxisLabels`
- `shouldRenderAsDiagnostic`
- `recommendedDisplayMode`

判定例:
- 全値同一: `isFlatSeries = true`
- 最大値が2以下、かつ点数が少ない: `isLowSample = true`
- line chart で seriesCount > 3: `hasTooManyLineSeries = true`
- labels.length > 12: x軸ラベルを間引き、重要日だけ表示

### Phase 2: 日別折れ線の読みやすさ改善

`ChartGroupCard.jsx` の line chart 表示を変更:
- デフォルト表示は上位1-2系列だけ濃くする
- 残り系列は薄くする、または折りたたみ詳細で表示
- 凡例はChart.js標準下部ではなく、HTMLの右側/下部リストにする
- 長いURLは短縮表示 + tooltip
- ピーク点のラベルは主要系列のみ
- x軸日付は全表示しない。週次/始点/終点/ピーク日中心

### Phase 3: 同一値ランキングを診断カードへ変更

直帰率が全部100%のようなケース:
- 棒グラフを出さない
- `比較差なし` カードにする
- `最大=最小=100%`、`差分=0`、`20LPすべて同値` を明示
- `avg_pages_per_session` や `sessions` など他指標への切替導線を出す

### Phase 4: 低サンプル検索クエリをトレンド扱いしない

検索クエリ日別推移:
- `actualCount < 5` または `max <= 2` の場合、line chart を出さない
- `検索回数が少ないため日別トレンド化しません` と表示
- 上位語の一覧、発生日、回数をテーブルで出す
- 期間拡張/全期間まとめ確認のCTAを出す

### Phase 5: Image Gen案から実装へ反映

1. 上記5枚のGPT Image2モックを生成
2. 最も良いパターンを1つ選ぶのではなく、用途別に採用する
3. React/Chart.jsへ実装
4. 右カラムでスクリーンショット比較
5. 文字・数値・ラベルは必ずDOM/Chart.jsで正確に出す

## テスト追加

Frontend:
- line chart で seriesCount > 3 の場合、主系列/補助系列の扱いが分かれる
- flat series の直帰率は `ChartDiagnosticCard` になる
- low sample search trend は line chart にならず `LowSampleChartState` になる
- ranking top15 は labels 15件を維持する
- 長いLP URLが legend/list で短縮される

Backend:
- 直帰率が全部100%のケースで metadata に `flat_series` warning または frontendで判定可能な値が返る
- search actualCount=3/max<=2 のケースで low_sample が出る
- chart metadata が title/selectionLabel/coverageLabel と矛盾しない

## 右カラム検証シナリオ

必須:
1. `npm run lint`
2. `npm run build`
3. `npm test -- src/utils/__tests__/adsReports.test.js src/components/ads/__tests__/ChartGroupCard.test.jsx`
4. `python -m pytest tests/test_bq_chart_builder_regression.py -q` from `backends/ads-insights`
5. `npm run dev -- --host 127.0.0.1`
6. 右カラムで `http://127.0.0.1:3002/ads/graphs`

目視確認:
- LP日別推移が現在より明らかに読みやすい
- 5系列が視覚的にぐちゃぐちゃに重ならない
- 直帰率100%のランキングが無意味な棒グラフにならない
- 検索クエリ上位3語の低サンプルが、トレンド風に誇張されない
- 地域別/OS別/LPランキング上位15/20のラベルが欠けない
- 右カラムAIへの導線は残る
- console/network error がない

隣接画面:
- `/ads/ai` を開いて console/network error がないこと

## 完了条件

- GPT Image2のモックが複数枚作成され、採用方針が明記されている
- 主要グラフタイプごとに表示モードが分かれている
- 「見づらい折れ線」「意味のない100%棒グラフ」「低サンプル折れ線」が解消されている
- 右カラムでユーザーが見て分かるレベルの変化がある
- PR作成、CI pass、merge、post-deploy-health pass まで完了

## 注意

- 既存の分析ロジックやBigQuery SQLの意味は不用意に変えない
- `null` を根拠なく `0` にしない
- `low_sample` は見た目だけで消さない
- GPT Image2の画像をそのままグラフ真実として使わない
- ユーザーは「右カラムでのブラウザ確認」を強く要求しているため、必ず実画面で確認する
- 見出し・チップ・凡例・図・テーブルの意味がズレたら今回の修正目的に反する

