`tmp_market_lens_ai_repo` の commit `4c8dc72` をレビューした結果、実装と完了報告の間に未解消の問題が残っています。  
このメッセージをそのまま使って、差分の follow-up fix を行ってください。

対象:

- `web/app/analyzer.py`
- `web/app/extractor.py`
- `web/app/report_generator.py`
- `tests/test_analyzer.py`
- `tests/test_extractor.py`
- `tests/test_report_generator.py`

必ず最初に読むこと:

- `plans/2026-04-11-compare-agency-grade-claude-plan.md`
- `plans/2026-04-11-discovery-quality-review-sports-supplement-report.md`

今回の目的は、`4c8dc72` の仕上げではなく、**レビューで見つかった実害バグと契約不一致を潰すこと** です。

## 修正必須の問題

### 1. `注記・前提条件` が最終レポートで二重出力される

現状:

- `web/app/analyzer.py` の deep comparison prompt は本文6セクションの `### 6. 注記・前提条件` をモデルに要求している
- しかし `web/app/report_generator.py` でも `## 注記・前提条件` を無条件で追記している

結果:

- 最終レポートで `注記・前提条件` が2回出る

修正方針:

- **どちらか1箇所を唯一の owner にすること**
- 推奨は `report_generator.py` 側を owner にし、prompt 側は 1-5 セクションにする
- もし prompt 側に残すなら、generator 側で既存見出しを検知して重複挿入しないこと

受け入れ基準:

- 最終 markdown に `## 注記・前提条件` が **ちょうど1回** だけ出る
- 重複を防ぐ regression test を追加する

### 2. `offer_terms / review_signals / shipping_signals` が比較 prompt に渡っていない

現状:

- extractor / models / report_generator には新フィールドが入っている
- しかし `build_deep_comparison_prompt()` と `build_wide_comparison_prompt()` は `_format_site_data(..., compact=True)` を使っており、
  compact branch に新フィールドが含まれていない

結果:

- Appendix A には出るが、比較本文を作る LLM の入力には入らない
- 追加抽出の価値が比較分析で活かされていない

修正方針:

- compact format にも最低限以下を含める:
  - `オファー条件`
  - `レビュー信号`
  - `配送条件`
- 特にスポーツサプリ / EC 系比較では `定期便`, `初回`, `レビュー件数`, `送料無料` を比較 prompt に乗せること

受け入れ基準:

- `build_deep_comparison_prompt()` に新フィールドの内容が実際に含まれる
- `build_wide_comparison_prompt()` にも含まれる
- 文字列存在確認の regression test を追加する

### 3. 4サイト以上の比較経路だけ旧フォーマットが残っている

現状:

- `analyze()` は `len(extracted_list) >= 4` で `build_wide_comparison_prompt()` を使う
- しかし wide prompt はまだ旧構造
  - `## 対象整理`
  - `## 総合サマリー`
  - `## 実行プラン`
  - `【高信頼】`
- deep prompt で入れた 6セクション固定契約と `確認済み / 推定 / 評価保留` に揃っていない

結果:

- Discovery 等の 4+ サイト比較では完了報告どおりの contract にならない

修正方針:

- `build_wide_comparison_prompt()` も deep prompt と同じ client-facing contract に揃える
- 最低でも以下を一致させる:
  - 6セクション構造
  - 見出し命名
  - `確認済み / 推定 / 評価保留`
  - `参考観測枠` の扱い

受け入れ基準:

- 4サイト prompt に `エグゼクティブサマリー` が存在する
- `対象整理` ではなく `分析対象と比較前提` になる
- `【高信頼】` ではなく `確認済み` 系に揃う
- wide prompt 専用の contract test を追加する

### 4. `購入系優先ロジック` が CSS selector path では効いていない

現状:

- `_extract_main_cta()` の Phase 1 は selector ごとに `select_one()` して最初の非 legal CTA を返す
- そのため `<a>お問い合わせ</a><a>今すぐ購入</a>` のような並びでは `お問い合わせ` を返しうる
- 購入系優先は Phase 2 fallback にしか効いていない

修正方針:

- Phase 1 でも候補を全部集めてスコアリングし、購入系 CTA を優先する
- 最低限の優先順:
  1. 購入 / 定期 / カート / 申込
  2. 資料請求 / 無料体験 / 見積り
  3. お問い合わせ
- legal reject は継続

受け入れ基準:

- 同一 CTA コンテナに `お問い合わせ` と `今すぐ購入` が共存するケースで `今すぐ購入` を返す
- regression test を追加する

### 5. 証拠強度の taxonomy が prompt 内で矛盾している

現状:

- ブランド別評価では `確認済み / 推定 / 評価保留`
- `_EVIDENCE_TRACE_REQUIREMENTS` では `強 / 中 / 弱`

結果:

- モデルに conflicting instructions を与えている

修正方針:

- taxonomy を 1 つに統一する
- 推奨:
  - `確認済み`
  - `推定`
  - `評価保留`
- どうしても `強 / 中 / 弱` を残すなら別名の列に分離すること

受け入れ基準:

- prompt 全体で `証拠強度` の定義が一貫する
- テストも old/new 両許容ではなく 1 契約に固定する

## 実装ルール

- file/line を見ながら最小差分で直すこと
- prompt の言い換えだけで終わらせないこと
- 実際に generator / extractor / tests まで揃えること
- 既存の unrelated failure は触らなくてよい

## 必須テスト

最低でも以下を pass させること:

1. `python -m pytest tests/test_analyzer.py tests/test_extractor.py tests/test_report_generator.py -q`

追加で必須の新規 test 観点:

1. `注記・前提条件` が final report に1回しか出ない
2. deep prompt に `offer_terms / review_signals / shipping_signals` が出る
3. wide prompt にも同様に出る
4. wide prompt が 6 セクション contract に揃う
5. CTA priority で `今すぐ購入` が `お問い合わせ` より優先される
6. 証拠強度 taxonomy が一貫する

## 最終報告で必ず書くこと

- どの問題をどう直したか
- `注記・前提条件` の owner をどちらにしたか
- compact prompt に追加したフィールド
- wide prompt をどう統一したか
- CTA scoring のルール
- 追加したテスト名
- 実行したテスト結果
