以下を Claude にそのまま投げてください。

```text
market-lens-ai の commit f339e4d をコードベースで再点検し、以下の指摘を修正してください。

前提:
- 変更対象 repo: market-lens-ai
- まず現状差分と既存テストを確認してから修正すること
- 推測で「直ったはず」と言わず、該当箇所の再現条件と回帰テストをセットで示すこと
- 既存の timeout / degrade retry の安定性を落とさないこと

今回の指摘事項:

1. 業界テンプレートが衝突している
- analyzer.py の deep / wide comparison prompt に、水回り固定観点が常時入っている
- スポーツサプリ業界でも水回り固定観点が同時に入り、分析軸が汚染される
- 修正方針:
  - 水回り固定観点は「水回り・住宅設備」系の industry のときだけ入れる
  - スポーツサプリ固定観点とは排他的、または少なくとも無関係な固定観点を混在させない
  - 必要なら業界別固定観点ビルダーを関数化する

2. 対象整理の整合性が未完成
- discovery_metadata に「実分析対象」がない
- 発見候補は full ranked list だが、analyze では site_limit や degrade retry で一部しか分析しない
- そのため「発見候補」と「実分析対象」がズレても、どれが未分析/除外なのかレポートに渡せていない
- excluded_candidates も品質除外だけで、site_limit 超過・degrade retry で落ちた候補理由が含まれない
- 修正方針:
  - analyze に渡す metadata に以下を追加:
    - analyzed_targets
    - deferred_candidates または omitted_candidates
    - exclusion_reason
  - attempt ごとに実際に分析した対象が prompt に明示されるようにする
  - 対象整理の入力は domain ベースと brand ベースが混在しないよう整える

3. competitive_tier の direct 判定が甘すぎる
- candidate_ranker.py の classify_competitive_tiers が
  score >= 60 and (industry match or LP signal)
  で direct にしている
- 現状の rank score は base 50 があり、"公式" "送料無料" などの LP signal だけで direct になりやすい
- blog や汎用 EC でも direct 化しうる
- 修正方針:
  - direct は LP signal だけで許可しない
  - direct は少なくとも industry match を必須にする、または stricter な複合条件にする
  - indirect / benchmark の閾値も見直す
  - できれば exact phrase 1個だけの industry match ではなく、業界キーワード集合や extracted content も使えるよう設計する

4. prompt 設計が重複していて出力を不安定にしている
- _build_discovery_context_section がすでに「対象整理」相当の見出しと表を持ち、
  さらに出力仕様でも `## 対象整理` を要求している
- これだと同名セクションの重複や、モデルが metadata をそのまま繰り返す問題が起きる
- prompt も肥大化している
- 修正方針:
  - metadata は「入力コンテキスト」として渡し、最終出力セクション名とは分ける
  - 例: `## Discovery入力メタデータ` と `## 対象整理` を分離
  - 4サイト以上 prompt の冗長文も整理し、完走優先を維持する

必須テスト:

1. analyzer.py
- スポーツサプリ industry のとき、水回り固定観点が prompt に入らないこと
- 水回り industry のとき、スポーツサプリ固定観点が prompt に入らないこと
- 対象整理 metadata に analyzed_targets / omitted_candidates が出ること
- deep / wide prompt で「入力コンテキスト」と最終出力 `## 対象整理` の役割が重複しないこと

2. candidate_ranker.py
- LP signal だけの generic EC / blog が direct にならないこと
- industry match + LP signal + 高スコアのケースは direct になること
- score は高いが業界不一致のケースは indirect 止まりになること

3. discovery_pipeline.py
- analyze attempt が 4サイト比較から 3サイト比較へ縮退した場合、metadata 上の analyzed_targets / omitted_candidates が正しく更新されること
- response / prompt の整合性に必要な metadata が analyze_fn に渡ること

受け入れ条件:
- 既存テストを壊さない
- 新規テストを追加し、今回の4指摘を再発防止できる
- 修正後に「何が原因で、どう直し、どのテストで保証したか」を短く報告する

報告フォーマット:
- Findings
- Fixes
- Tests
- Residual risks
```
