# Fix: gen_prompt_builder.py の無意味なソートを修正

## Context

コミット `0c63012` で `gen_prompt_builder.py` に改善点の優先度ソート（2-C）が追加されたが、
`ImprovementPoint` スキーマに `score` フィールドが存在しないため、`getattr(imp, 'score', 999)` が常に 999 を返し、ソートが無意味になっている。

`ImprovementPoint` は `point`, `reason`, `action` のみ。`RubricScore` には `score` があるが `rubric_id` ベースで、`ImprovementPoint` との直接マッピングは無い。テキストマッチングは脆弱なので採用しない。

## 修正方針

**`rubric_scores` の低スコア順を利用して、改善点の並び順に意味を持たせる。**

LLMが生成する `improvements` リストは順序保証がないため、`rubric_scores` の低スコア軸を先にプロンプトで提示し、Geminiに優先度を伝える。

## 対象ファイル

```
c:\Users\PEM N-266\work\market-lens-ai\web\app\services\generation\gen_prompt_builder.py
```

## 変更内容

### Step 1: ソートを `rubric_scores` ベースに変更

現在のコード（L20-28）:
```python
# スコアが低い順にソートして優先度を明示
sorted_improvements = sorted(
    review_result.improvements,
    key=lambda imp: getattr(imp, 'score', 999),
)
improvements_text = "\n".join(
    f"- 【優先度{i+1}】{imp.point}: {imp.action}"
    for i, imp in enumerate(sorted_improvements)
)
```

修正後:
```python
# rubric_scoresの低スコア軸名を取得（優先度の参考情報）
weak_axes = sorted(review_result.rubric_scores, key=lambda rs: rs.score)
weak_axis_names = [rs.rubric_id for rs in weak_axes]

# improvements はLLM出力順のまま、優先度番号を付与
improvements_text = "\n".join(
    f"- 【優先度{i+1}】{imp.point}: {imp.action}"
    for i, imp in enumerate(review_result.improvements)
)

# 弱い軸を明示してGeminiに優先度を伝える
weak_axes_text = "、".join(
    f"{rs.rubric_id}({rs.score}/5)" for rs in weak_axes[:3]
)
```

### Step 2: プロンプトに弱い軸の情報を追加

「改善すべき点とアクション」セクションの直前に追記:

```
## 特に弱い評価軸（優先的に改善）
{weak_axes_text}
```

これにより、Geminiが「どの軸が低スコアか」を知った上でデザイン改善を行える。

### Step 3: 不要な `sorted` import があれば確認（`sorted` は組込みなので不要）

## 変更しないもの

- `ImprovementPoint` スキーマ — `extra="forbid"` なので `score` 追加は影響範囲が大きい
- 2-A（デザイン原則）、2-B（チェックリスト）— レビュー済み、問題なし

## 検証方法

1. `cd c:\Users\PEM N-266\work\market-lens-ai`
2. `python -c "from web.app.services.generation.gen_prompt_builder import build_banner_gen_prompt; print('import OK')"`
3. `pytest tests/ -x -q` — 全テストパス確認
4. 変更後のプロンプト出力を目視確認:
   ```python
   # 簡易テスト: ReviewResult のモックを作って build_banner_gen_prompt を呼び、
   # "特に弱い評価軸" セクションが含まれることを確認
   ```

## コミット

```bash
cd c:\Users\PEM N-266\work\market-lens-ai
git add web/app/services/generation/gen_prompt_builder.py
git commit -m "fix: use rubric_scores for improvement priority in gen prompt

ImprovementPoint has no score field, so getattr fallback always returned
999 making the sort no-op. Instead, surface weak rubric axes explicitly
to guide Gemini's design priorities."
```
