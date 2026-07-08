# クリエイティブレビュー品質強化プラン

## Context

クリエイティブレビュー（広告-LP整合性レビュー）のプロダクション出力を広告運用プロ視点で評価した結果、以下4点の改善余地を特定した。レビュー自体は実用レベルだが、スコアリングの公平性・分析の深度を上げることで、運用担当者にとって更に信頼性の高いツールにする。

---

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py` | プロンプト強化（全4件） |
| `tmp_market_lens_ai_repo/web/app/schemas/review_result.py` | スキーマ拡張（N/A対応、新フィールド） |
| `tmp_market_lens_ai_repo/docs/creative-review/contracts/review-output.schema.json` | JSONスキーマ更新 |
| `tmp_market_lens_ai_repo/web/app/services/review/review_output_validator.py` | Null score警告追加 |
| `src/pages/CreativeReview.jsx` | N/A表示、新セクション2件追加 |
| `src/components/PerformanceRadar.jsx` | N/A軸のビジュアル処理 |

---

## Issue 1: LPデータ不足時のN/Aスコア

### 問題
LP取得制限時に `ad_to_lp_message_match` (2/5)、`story_consistency` (2/5) 等、データ不足で公平な評価ができない項目にも低スコアが付く。プロンプトで「3をベースラインに」と指示しているが守られていない。

### 方針
- `score: null` を許可し、LPデータ不足の項目は N/A として出力させる
- フロントエンドで N/A 表示、平均スコア・レーダーから除外

### 設計判断
- `null` を使用（`-1` は magic number、`evaluable: false` は冗長）
- `PerformanceRadar.computeAxes` は既に `score != null` でフィルタ済み → 自然に除外される
- N/A 軸はレーダー上で破線表示（軸自体は残す — 4軸ダイヤモンドの形状を維持）

### LP依存ルーブリックID（N/A対象）
- `ad_to_lp_message_match`
- `input_friction`
- `story_consistency`

### 実装詳細

**1a. Backend Schema — `review_result.py`**

`RubricScore.score` を `Optional[int]` に変更:
```python
score: Optional[int] = Field(default=None, ge=1, le=5)
```

**1b. Backend Prompt — `review_prompt_builder.py`**

LP依存IDを定数として追加:
```python
LP_DEPENDENT_RUBRIC_IDS = [
    "ad_to_lp_message_match",
    "input_friction",
    "story_consistency",
]
```

`lp_data_warning` ブロック（L213-221）を差し替え:
- LP依存項目は `score: null` を出力するよう明示的に指示
- 他の項目はバナー画像から評価可能な範囲で採点

出力フォーマットの `"score": 1-5` を `"score": "1-5 または null（評価不能時）"` に変更。

**1c. Backend Validator — `review_output_validator.py`**

LP非依存項目に null score が出た場合に warning を出す（error ではない）。

**1d. Frontend RubricSection — `CreativeReview.jsx`**

- 平均スコア計算: `score != null` の項目のみで計算
- N/A 項目: スコア欄に "N/A" 表示、バーを破線パターンに

**1e. Frontend Radar — `PerformanceRadar.jsx`**

- 軸グループ全体が N/A の場合: スコア表示を "N/A" に、軸線を `strokeDasharray="4 3"` で破線化
- Total Score: N/A 項目は分母から除外（既存ロジックで対応済み）

---

## Issue 2: 業界コンテキストの追加

### 問題
レビューが広告単体の分析のみで、同業界の広告パターンとの比較視点がない。

### 方針
- `category_context` フィールド（optional）を追加
- AIの学習知識ベースで業界カテゴリを推定し、1-2 の観察を付与
- 外部データ不要

### 実装詳細

**2a. Backend Schema — `review_result.py`**

```python
class CategoryContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inferred_category: str = Field(min_length=1)
    observations: list[str] = Field(min_length=1)
```

`ReviewResult` に `category_context: Optional[CategoryContext] = None` 追加。

**2b. Backend Prompt — `review_prompt_builder.py`**

カテゴリコンテキスト指示を追加（バナー・LP両プロンプトに）:
```
## カテゴリコンテキスト
画像から業界カテゴリを推定し、category_context に記載:
- inferred_category: 業界名（例: インテリアEC、化粧品、金融）
- observations: その業界の広告傾向における位置づけを1-2文
```

出力フォーマットに `category_context` フィールド追加。

**2c. Frontend — `CreativeReview.jsx`**

`CategoryContextSection` コンポーネント追加。`NeutralInfoSection` の後に配置。icon: `category`。

---

## Issue 3: 価格・インセンティブ分析

### 問題
バナーに価格条件とインセンティブ（例: 「20万円以上でLucanoプレゼント」）が含まれる場合、購入条件に対するインセンティブの知覚価値比率への言及がない。

### 方針
- `value_proposition_analysis` フィールド（optional）を追加
- 価格・インセンティブ情報が検出された場合のみ出力

### 実装詳細

**3a. Backend Schema — `review_result.py`**

```python
class ValuePropositionAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purchase_threshold: str = Field(min_length=1)
    incentive: str = Field(min_length=1)
    perceived_value_assessment: str = Field(min_length=1)
    communication_clarity: str = Field(min_length=1)
```

`ReviewResult` に `value_proposition_analysis: Optional[ValuePropositionAnalysis] = None` 追加。

**3b. Backend Prompt — `review_prompt_builder.py`**

条件付き分析指示を追加:
```
## 価値提案分析（条件付き）
価格・購入条件・インセンティブがバナーに含まれている場合のみ出力:
- 購入条件に対するインセンティブの知覚価値は十分か
- 価値提案の伝達は明確か
```

**3c. Frontend — `CreativeReview.jsx`**

`ValuePropositionSection` コンポーネント追加。`ImprovementsSection` の後に配置。icon: `payments`。

---

## Issue 4: スコアリングキャリブレーション

### 問題
スコアが 2-3 に集中しがち。プロフェッショナルなバナーのベースラインが 3 であることが明確でなく、AIが過度に厳しく採点する傾向。

### 方針
`_SCORING_SCALE` を強化。具体例を追加し、3（標準）がデフォルトベースラインであることを明示。

### 実装詳細

`_SCORING_SCALE`（L69-80）を差し替え:
- 各スコア（2-4）に具体例を追加
- 「ベースラインは3」を明言
- 「明確な強みが1つでもあれば3以上を検討」を追加
- 全項目2以下に集中する場合は「厳しすぎる可能性が高い」と警告

---

## 実装順序

```
1. Issue 1 (N/Aスコア) + Issue 4 (キャリブレーション) — 同時実施
   → Backend schema/prompt/validator → Frontend rubric/radar
2. Issue 2 (カテゴリコンテキスト) — 独立
   → Backend schema/prompt → Frontend section
3. Issue 3 (価値提案分析) — 独立
   → Backend schema/prompt → Frontend section
```

Issue 2 と 3 は相互依存なし、並列実施可能。

---

## コミット戦略

| # | リポ | 内容 |
|---|------|------|
| 1 | `tmp_market_lens_ai_repo` | Backend: schema + prompt + validator（全4件） |
| 2 | `insight-studio` | Frontend: N/A表示 + 新セクション2件 |

---

## 検証方法

### Backend
- `RubricScore(score=None)` がPydantic検証をパスすること
- 既存の全数値スコアデータが引き続き検証をパスすること（後方互換）
- `category_context`, `value_proposition_analysis` がOptionalとして機能すること
- プロンプトに新しい指示ブロックが含まれること

### Frontend
- 全数値スコア（既存データ）で表示が崩れないこと
- 3件のnullスコアを含むレビューでN/A表示・レーダー破線が機能すること
- `category_context` あり/なしで正しくセクション表示/非表示されること
- `value_proposition_analysis` あり/なしで正しくセクション表示/非表示されること
- `npm run build` がパスすること

### E2E
- 本番環境でLP付きレビューを実行し、LPデータ制限時にN/Aスコアが出力されること
- バナーレビューで `category_context` が生成されること
- 価格情報を含むバナーで `value_proposition_analysis` が生成されること

---

## リスクと緩和策

| リスク | 緩和策 |
|--------|--------|
| LLMが指示に従わず null を出力しない | プロンプトで明示的にID列挙。改善しない場合はサービス層で後処理を追加 |
| トークン予算超過 | 追加指示は合計約20行。`_CONCISE_OUTPUT_RULES` が出力長を抑制 |
| `additionalProperties: false` でスキーマ不整合 | Pydantic model と JSON Schema の両方に新フィールドを追加 |
