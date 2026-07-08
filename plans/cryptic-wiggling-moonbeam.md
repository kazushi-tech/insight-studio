# Creative Review: LLM出力パースエラー修正

## Context

Creative Review（バナーレビュー / 広告+LP統合レビュー）で以下のエラーが発生:
- `レビュー失敗: LLM output parse failed: JSON parse error: Expecting value: line 1 column 1 (char 0)`
- DevTools上で `/api/reviews/ad-lp` が422を連続返却

**根本原因:** Claude APIが空レスポンスまたはJSON以外のテキストを返した際、`parse_review_json("")` → `json.loads("")` で失敗。
- `_extract_text_from_message()` はテキストブロックが存在すれば空文字でもraiseしない（L142-143）
- パース失敗時のリトライ機構がなく、一発で失敗確定
- `review_routes.py` が全 `BannerReviewError` を422で返すため、フロントの自動リトライ（500/502/503のみ対象）が効かない

## 修正内容（5ファイル）

### 1. `review_output_validator.py` — パース堅牢化

**ファイル:** `web/app/services/review/review_output_validator.py` L39-54

- 空入力ガード: `raw.strip()` が空なら即座に `(None, "Empty LLM response")` を返す
- JSON抽出フォールバック: markdownフェンスにマッチしない場合、最初の `{` 〜 最後の `}` を切り出して `json.loads` を試行（Claudeが前後に説明文を付けるケースに対応）
- パース失敗時に `raw[:500]` をログ出力

```python
def parse_review_json(raw: str) -> tuple[dict | None, str | None]:
    text = raw.strip()
    if not text:
        return None, "Empty LLM response"

    # Strip markdown code fences
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    else:
        # Fallback: extract outermost JSON object
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end > start:
            text = text[start:end + 1]

    try:
        return json.loads(text), None
    except json.JSONDecodeError as e:
        logger.warning("JSON parse failed, raw[:500]=%s", raw[:500])
        return None, f"JSON parse error: {e}"
```

### 2. `banner_review_service.py` — パースリトライ追加

**ファイル:** `web/app/services/review/banner_review_service.py`

LLM呼び出し→パースの部分にリトライループ（1回リトライ）を追加。リトライ時はプロンプトにエラーフィードバックを付加してClaudeに自己修正させる。

- `_MAX_PARSE_RETRIES = 1` を追加
- パース失敗時にログ出力 + リトライ（プロンプトにJSON制約を再強調）
- リトライ時も multimodal/text-only の選択を維持

### 3. `ad_lp_fit_service.py` — パースリトライ追加

**ファイル:** `web/app/services/review/ad_lp_fit_service.py`

banner_review_service.py と同様のパースリトライを追加。

### 4. `review_routes.py` — LLMパースエラーを502に変更

**ファイル:** `web/app/routers/review_routes.py`

既に未コミットの修正が存在（`"LLM output parse"` / `"output validation failed"` を含むエラーを502で返す）。これをそのままコミット。

**効果:** フロントエンドの `isReviewRetryableError()` が502をリトライ対象として認識 → 自動リトライが有効化。

### 5. `_extract_text_from_message` — 空テキストガード

**ファイル:** `web/app/anthropic_client.py` L139-144

テキストブロックが存在するが中身が空/空白のみの場合もraiseするよう修正。

```python
def _extract_text_from_message(message: anthropic.types.Message) -> str:
    texts = [block.text for block in message.content if block.type == "text"]
    if not texts:
        raise RuntimeError("Anthropic response did not contain text content.")
    result = "\n".join(texts).strip()
    if not result:
        raise RuntimeError("Anthropic response contained empty text content.")
    return result
```

**Note:** 返り値の型（2-tuple）は変更しない。`stop_reason` の伝播は影響範囲が大きいため今回は見送り。

## 実装順序

| Step | 内容 | ファイル |
|------|------|---------|
| 1 | パース堅牢化（空ガード + JSON抽出フォールバック） | `review_output_validator.py` |
| 2 | 空テキストガード | `anthropic_client.py` |
| 3 | パースリトライ追加 | `banner_review_service.py` |
| 4 | パースリトライ追加 | `ad_lp_fit_service.py` |
| 5 | 502エラー分類修正（既存diff） | `review_routes.py` |
| 6 | テスト実行 → コミット → プッシュ | — |

## 検証方法

1. `python -m pytest tests/ -x -q` で全テスト通過を確認
2. Render デプロイ後、Creative Review で画像アップロード → レビュー実行
3. エラー時に「AI出力解析エラー」+ 再試行ボタンが表示され、再試行で成功することを確認
