# クリエイティブ診断 品質改善計画

## Context
ユーザーがクリエイティブ診断で改善バナーを生成したところ、3つの深刻な問題が発生:
1. **文字化け・ハルシネーション** — Geminiが元バナーのテキストを正確に再現できず、意味不明な文字列を生成
2. **Performance Radarの見づらさ** — Before/After比較時に2つの巨大なRadarが並び、情報過多で読めない
3. **改善バナーが45/100** — 90点以上を期待しているのに低スコア（原因は主に#1の文字化け）

根本原因: 生成プロンプトが元バナーのテキスト内容を明示せず、Geminiが参照画像からテキストを推測→ハルシネーション

## Part 1: テキスト保持による生成品質向上（Backend - market-lens-ai）

### Step 1.1: ReviewResultスキーマにテキスト抽出フィールド追加
**File**: `web/app/schemas/review_result.py`

新しいモデル `VisibleTextElement` を追加し、`ReviewResult` に `visible_text_elements` フィールドを追加:
```python
class VisibleTextElement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str = Field(min_length=1)  # headline / sub_copy / cta / price / note / brand_name
    text: str = Field(min_length=1)  # 正確なテキスト文字列
    approximate_position: str = Field(default="")  # top-left, center, bottom-right 等

# ReviewResult に追加:
visible_text_elements: list[VisibleTextElement] = Field(default_factory=list)
```
- `default_factory=list` で既存データとの後方互換性を確保
- `extra="forbid"` に合わせた厳密なモデル定義

### Step 1.2: レビュープロンプトにテキスト抽出指示追加
**File**: `web/app/services/review/review_prompt_builder.py`

`_OUTPUT_FORMAT_INSTRUCTIONS` (L37-66) の JSON テンプレートに追加:
```json
"visible_text_elements": [
    {"role": "headline/sub_copy/cta/price/note/brand_name", "text": "正確なテキスト", "approximate_position": "位置"}
]
```

`build_banner_review_prompt()` (L138) に新しい指示セクション追加:
```
## 重要: テキスト要素の正確な抽出
バナー画像に含まれるすべてのテキスト要素を visible_text_elements に正確に記録:
- headline, sub_copy, cta, price, note, brand_name をすべて抽出
- 1文字も変更せず、画像に表示されている通りの文字列を記載
```

### Step 1.3: 生成プロンプトにテキスト保持指示を強化
**File**: `web/app/services/generation/gen_prompt_builder.py`

主な変更:
1. `visible_text_elements` からテキスト一覧を構築し、プロンプトに挿入
2. 最重要ルールを強化: 「テキストを自分で生成・推測しないこと。指定文字列のみ使用」
3. フォールバック: `visible_text_elements` が空の場合は `product_identification` 等から推定
4. 最終チェックリストにテキスト一致確認を追加

```python
text_elements = getattr(review_result, 'visible_text_elements', [])
if text_elements:
    text_block = "\n".join(
        f"- 【{e.role}】「{e.text}」（{e.approximate_position}）" for e in text_elements
    )
    # → "## 最重要: テキスト要素の完全保持" セクションとしてプロンプトに挿入
```

## Part 2: Performance Radar 簡素化（Frontend - insight-studio）

### Step 2.1: compact モード追加
**File**: `src/components/PerformanceRadar.jsx`

1. `compact` prop 追加 (L133): `({ rubricScores, reviewType, compact = false })`
2. compact 時の変更:
   - ヘッダー簡素化: タイトル非表示、Total Score バッジのみ（小さく）
   - SVG コンテナ: `max-w-[32rem]` → `max-w-[20rem]`、パディング削減
   - ラベル: `text-[1.75rem] md:text-4xl` → `text-lg`
   - スコア内訳グリッド (L301-322): 非表示
   - 要約カード (L325-352): 非表示
   - `mt-10` → `mt-4`、`p-6 md:p-8` → `p-3 md:p-4`

3. グリッド線コントラスト改善（全モード共通）:
   - 内側グリッド: opacity `0.22` → `0.40`
   - 外枠: opacity `0.34` → `0.55`
   - 軸線: opacity `0.22` → `0.40`

### Step 2.2: Before/After比較で compact を使用
**File**: `src/pages/CreativeReview.jsx` (L952-961)

```jsx
<PerformanceRadar rubricScores={beforeScores} reviewType={...} compact />
<PerformanceRadar rubricScores={afterScores} reviewType="banner_review" compact />
```

## Part 3: 再生成UXの改善（Frontend - insight-studio）

### Step 3.1: 低スコア時の再生成提案
**File**: `src/pages/CreativeReview.jsx` (L964付近)

After スコアが60未満の場合、再生成を促すメッセージ+ボタンを表示:
```jsx
{afterReviewResult && afterAvg < 60 && (
  <div className="bg-amber-50 border border-amber-200 rounded-[0.75rem] p-4">
    <p>スコアが低いため、再生成をお試しください</p>
    <button onClick={handleGenerate}>再生成する</button>
  </div>
)}
```

## 実装順序

| Step | リポ | ファイル | リスク | 効果 |
|------|------|---------|--------|------|
| 1.1 | market-lens-ai | schemas/review_result.py | 低 | 基盤 |
| 1.2 | market-lens-ai | review_prompt_builder.py | 低 | 基盤 |
| 1.3 | market-lens-ai | gen_prompt_builder.py | 中 | **最大** |
| 2.1 | insight-studio | PerformanceRadar.jsx | 低 | 高 |
| 2.2 | insight-studio | CreativeReview.jsx | 低 | 高 |
| 3.1 | insight-studio | CreativeReview.jsx | 低 | 中 |

## 検証方法

1. **テキスト保持**: レビュー実行 → `visible_text_elements` がレスポンスに含まれるか確認 → バナー生成 → 生成画像のテキストが元バナーと一致するか目視確認
2. **Radar可読性**: Before/After表示でcompactレーダーが読めるか目視確認
3. **スコア向上**: テキスト保持改善後、再度バナー生成→レビューを実行し45点以上（目標65+）を確認
4. **後方互換**: 既存のreview_run_idで生成が動作することを確認（visible_text_elements=[]フォールバック）
5. **テスト**: `pytest` 全テスト通過確認

## 重要な制約

- `ReviewResult` は `extra="forbid"` なので、JSON出力とスキーマの変更を同時に行う必要あり
- `review-output.schema.json` がある場合はそちらも更新が必要
- Geminiのテキスト生成精度には限界があるため、90/100は現実的に困難。65-75が妥当な目標
