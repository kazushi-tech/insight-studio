# Creative Review — Glossary

このドキュメントは Creative Review 機能で使用する用語を定義する。
schema, rubric, fixture, prompt, UI はすべてこの glossary の名称に従う。

---

## Review Output Fields

| Field | 型 | 説明 |
|-------|-----|------|
| `summary` | string | レビュー全体の要約（1-3 文） |
| `good_points` | array of object | 良い点。必ず最初に提示する |
| `keep_as_is` | array of object | 変えない方がよい要素 |
| `improvements` | array of object | 改善提案。行動可能な粒度で書く |
| `test_ideas` | array of object | 次に試す AB テスト仮説（3 案程度） |
| `evidence` | array of object | 提案の根拠ソース一覧 |
| `target_hypothesis` | string | 想定ターゲットの仮説 |
| `message_angle` | string | 訴求軸の要約 |
| `rubric_scores` | array of object | rubric 各項目のスコアとコメント |
| `one_pager_sections` | object | 1 枚資料用のセクション構造 |

## Review Types

| Term | 説明 |
|------|------|
| `banner_review` | バナー単体の講評。Banner Rubric に基づく |
| `ad_lp_review` | 広告と LP の整合レビュー。LP Rubric に基づく |
| `positioning_compare` | 自社 vs 競合のポジショニング比較（Pack A スコープ外） |

## Rubric Terms

| Term | 説明 |
|------|------|
| `rubric_item` | rubric の 1 評価軸 |
| `rubric_id` | rubric 項目の一意キー（例: `hook_strength`） |
| `score` | 1-5 の整数スコア |
| `comment` | スコアの根拠コメント |

## Evidence Terms

| Term | 説明 |
|------|------|
| `evidence_source` | 根拠の出典元。evidence-policy.md の allowed_sources に限定 |
| `evidence_type` | ソース種別（`client_material`, `approved_proposal`, `winning_creative`, `competitor_public`, `platform_guideline`） |
| `evidence_text` | 引用テキストまたは要約 |
| `forbidden_claim` | evidence-policy.md で禁止された表現パターン |

## One-Pager Terms

| Term | 説明 |
|------|------|
| `one_pager` | クライアント提出用の 1 枚サマリー資料 |
| `section` | one-pager 内のブロック（header, good_points, keep_as_is, improvements, test_ideas, evidence_sources） |

## Asset Terms

| Term | 説明 |
|------|------|
| `creative_asset` | レビュー対象のバナー画像やスクリーンショット |
| `asset_id` | アセットの一意 ID（12 文字 hex） |
| `landing_page_url` | LP の URL。allowlist に従う |
| `brand_info` | 任意のブランド情報メモ |

## Scoring Scale

| Score | Label | 意味 |
|-------|-------|------|
| 1 | Poor | 重大な問題あり、すぐ改善が必要 |
| 2 | Below Average | 改善の余地が大きい |
| 3 | Average | 標準的、小さな改善で向上可能 |
| 4 | Good | 良好、微調整レベル |
| 5 | Excellent | 優秀、このまま維持 |
