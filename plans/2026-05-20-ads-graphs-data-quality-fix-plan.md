# 広告グラフ データ品質修正計画

作成日: 2026-05-20
対象: `/ads/graphs`, `backends/ads-insights/web/app/bq_chart_builder.py`, `backends/ads-insights/bq/reporter.py`, `src/utils/adsReports.js`, `src/pages/AnalysisGraphs.jsx`, `src/components/ads/ChartGroupCard.jsx`

## 目的

`/ads/graphs` のグラフ表示を、実データ件数・欠損・期間対応・部分失敗が読み手に正しく伝わる状態へ直す。

今回の問題は、単なるUI順序や外枠ではなく、次の不信感を生むデータ品質問題として扱う。

- `Top 20` と表示しながら、実際には2件や3件しか表示されない
- テーブルに空欄や `-` が出るが、欠損なのか対象外なのか分からない
- 全期間まとめで、期間ごとにカテゴリ集合が違うランキンググラフをタイトルだけで統合している
- 一部クエリが失敗または空でも、画面上は理由が見えにくい
- 自動テストが正常系中心で、低サンプル・欠損・ラベル/値不整合を落とせない

## 非目標

- GA4 / BigQuery の本番データを推測で補完しない
- `null` を計算用JSONから消して、根拠のない0埋めをしない
- 広告費ExcelやCPAなど、未接続データを取得済みとして見せない
- 今回の計画段階で本番デプロイはしない

## オーケストレーター体制

Codexをオーケストレーターとして進行する。

1. Backend Data Agent
   - 所有範囲: `bq_chart_builder.py`, `reporter.py`, `backend_api.py`, `bq/queries.py`
   - 役割: Top件数、欠損、部分失敗、chart metadata の契約を整える

2. Frontend Contract Agent
   - 所有範囲: `src/utils/adsReports.js`, `src/components/ads/ChartGroupCard.jsx`, `src/pages/AnalysisGraphs.jsx`
   - 役割: chart_data の正規化、表示可否、テーブル欠損表示、全期間まとめ統合を整える

3. Regression Test Agent
   - 所有範囲: `backends/ads-insights/tests/`, `src/utils/__tests__/`, `src/components/ads/__tests__/`, `src/pages/__tests__/`
   - 役割: 低サンプルTop20、null/NaN、ラベル/値不一致、部分失敗の負例テストを追加する

4. Browser QA Agent
   - 所有範囲: `scripts/` のCDP/Playwright検証、Codex右カラムでのブラウザ確認
   - 役割: `/ads/graphs` を右カラムで開き、実画面で「Top件数・欠損警告・テーブル・コンソール」を確認する

## 主要所見

### Major 1: Top 20 が実件数ではなく上限文言になっている

`bq_chart_builder.py` は検索クエリで `agg.head(20)` を使うが、タイトルは常に `検索クエリ — Top 20` になる。実データが2件ならグラフも2件になるため、処理としては自然だが、UI文言としては「20件ある」と読めてしまう。

同じ問題は `LP分析 — セッション数 Top 20`, `LP分析 — 直帰率 Top 20`, `OS別 Top 10`, `地域別 Top 15` にも起きる。

### Major 2: 全期間まとめの同名グラフ統合が危険

`src/utils/adsReports.js` の `mergeChartGroupsByTitle()` はタイトルだけでグラフをまとめ、最初の期間の `labels` を残したまま、他期間の `datasets` を追加する。

ランキング系グラフは期間ごとに上位カテゴリが変わるため、5月の値が4月の検索語ラベルに乗るような誤表示が起きうる。

### Major 3: 期間と結果の対応が index 前提

`buildAdsReportBundle()` は `periods[index]` と `results[index]` の対応を前提にしている。一方、ウィザード側では未生成期間だけを `pendingPeriods` として取得する経路がある。

既存期間と新規期間が混在すると、グラフの期間タグや `periodReports` がずれる可能性がある。

### Major 4: 欠損セルの意味が統一されていない

欠損は層ごとに違う表現になっている。

- Markdown本文: `None/NaN` が空文字になり、空欄として見える
- chart JSON: `NaN` が `null` になる
- 分析画面の生データテーブル: `null` が `-` になる

読み手から見ると、空欄、`-`, 非表示の違いが分からない。

### Major 5: 自動テストが負例を捕まえられない

現状のテストは `matchRelevantCharts` や MarkdownRenderer の通過確認が中心で、以下を落とせない。

- `Top 20` なのに実データ2件
- `labels.length !== datasets[*].data.length`
- 全 `null` のデータ系列が描画可能扱い
- 部分失敗したクエリが画面で見えない
- テーブルの空欄が欠損警告なしで出る

## 修正方針

### Phase 0: 既存UI順序修正の扱いを確定

現時点のローカルには、前指示に基づく `/ads/graphs` の表示順変更とグラフ外枠簡素化の未コミット差分がある。

次の実装では、これを同じ修正に含めるか、いったん別PRに分けるかを最初に決める。いずれの場合も、本番反映前に右カラムでブラウザ確認する。

### Phase 1: Backend chart metadata を追加

各 chart group に、表示判断に必要な metadata を付ける。

推奨フィールド:

```json
{
  "queryType": "search",
  "limit": 20,
  "actualCount": 3,
  "sourceRowCount": 3,
  "coverageLabel": "上位3件 / 最大20件",
  "warnings": ["low_sample"]
}
```

修正対象:

- `build_bq_chart_data()`
- `_build_search()`
- `_build_landing()`
- `_build_device()`
- `_build_user_attr()`
- `reporter.py` の Markdown 見出し
- `backend_api.py` の batch response

受け入れ基準:

- `Top 20` 固定ではなく `上位3件 / 最大20件` のように実件数が読める
- 実件数が少ない場合は `low_sample` warning が付く
- `skipped` は query type だけでなく理由を持つ

### Phase 2: Frontend chart contract を正規化

`src/utils/adsReports.js` に chart group 正規化層を置く。

必須処理:

- `labels.length` と各 `dataset.data.length` の差分を検出
- 短い dataset は `null` で揃え、欠損数を metadata に保持
- 長い dataset は黙って捨てず、`overflowPoints` として検出
- 全期間まとめはタイトルだけで統合しない
- ランキング系は期間ごとのカテゴリ union で再配置するか、期間別カードとして分離する

受け入れ基準:

- ラベルと値の対応が崩れたグラフは無警告で描画されない
- 全期間まとめで検索語やLP名が混線しない
- 「グラフ数」は表示グループ数なのか元グラフ数なのかが分かる文言になる

### Phase 3: 欠損表示を統一

UI表示方針:

- 欠損値: `欠損`
- 計算不能: `算出不可`
- 対象データなし: `データなし`
- API/クエリ失敗: `取得失敗`
- JSON上の計算用値: `null` 維持

修正対象:

- `AnalysisGraphs.jsx` の生データテーブル
- `ChartGroupCard.jsx` の描画可否と点数バッジ
- `MarkdownRenderer.jsx` または Markdown生成側
- `reporter.py` の `_escape_markdown_cell`

受け入れ基準:

- 表に単なる空欄が残らない
- `-` だけで欠損を隠さない
- 欠損があるグラフにはカード内または直上に警告が出る

### Phase 4: グラフ表示の過剰演出を抑える

既に着手した外枠簡素化を、データ品質修正後に再確認する。

方針:

- グラフカードは通常の白背景 + 明確な境界線
- 内側の装飾的な描画エリア枠は削除または最小化
- 「Python描画エリア」など、見た目の説明ラベルは不要なら削除
- 見た目より、欠損警告・実件数・系列数が読めることを優先

### Phase 5: Regression tests

追加するテスト:

1. Backend pytest
   - `test_search_top20_low_support_is_flagged`
   - `test_landing_top20_actual_count_label`
   - `test_chart_builder_flags_blank_ranking_values`
   - `test_generate_batch_returns_skipped_reason`

2. Frontend unit tests
   - `normalizeChartGroupShape` のラベル/値不一致
   - `getDisplayChartGroups` の全期間ランキング統合
   - `buildAdsReportBundle` の period/result 対応

3. Component tests
   - `ChartGroupCard` が全null系列を描画可能扱いしない
   - `AnalysisGraphs` が欠損テーブルを警告なしで出さない

### Phase 6: 右カラムブラウザ確認

必須。完了条件として、Codex右カラムでブラウザ確認できる状態にする。

手順:

1. `npm run build`
2. frontend unit tests
3. backend pytest
4. `npm run dev -- --host 127.0.0.1`
5. Codex右カラムのブラウザで `http://127.0.0.1:3002/ads/graphs` を開く
6. 低サンプル mock を注入した状態で確認
7. 隣接画面として `/ads/ai` も開く
8. console/network error を確認

右カラムで見る観点:

- `Top 20` が「20件ある」ように見えない
- 2件/3件だけのデータは `上位2件 / 最大20件` のように読める
- 空欄や `-` が警告なしで出ない
- 欠損がある場合、欠損理由または `算出不可` が見える
- 全期間まとめでラベルと値が混線していない
- AI右カラムに渡す前提として、グラフ根拠が明示されている

## 実装順

1. Backend metadata と Markdown見出しを直す
2. Frontend正規化層を追加する
3. 全期間まとめの統合ロジックを直す
4. 欠損テーブル表示を直す
5. グラフカードの実件数/欠損バッジを直す
6. テストを追加する
7. 右カラムでブラウザ確認する
8. 問題がなければ commit / push / deploy を行う

## 完了条件

- Critical/Major のデータ品質指摘が0
- `npm run build` 成功
- 追加した frontend tests 成功
- 追加した backend pytest 成功
- Codex右カラムで `/ads/graphs` と `/ads/ai` の確認完了
- 本番反映する場合は Vercel Ready と本番URLでの確認まで完了

