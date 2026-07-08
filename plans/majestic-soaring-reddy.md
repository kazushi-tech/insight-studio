# Fix: Creative Review エラー分類バグ（LLM parse error が「入力エラー」になる）

## Context

Creative Review（バナーレビュー）で「広告+LP統合レビューを実行」すると、バックエンドのLLMが空レスポンスを返した場合に：
- バックエンド: `AdLpReviewError("LLM output parse failed: ...")` → HTTP 422
- フロントエンド: `classifyError()` が 422 を先にチェック → **「入力エラー（retryable: false）」に誤分類**
- 本来は「AI出力解析エラー（retryable: true）」になるべき

ユーザーにとって「入力エラー」と表示されるのは混乱の元。実際にはLLM側の問題で再試行可能。

## 修正内容

### Step 1: フロントエンド — `classifyError()` のチェック順序修正

**ファイル:** `src/api/marketLens.js` L82-99

LLM parse error のメッセージチェック（L96-99）を、422/400 ステータスチェック（L82-84）の**前**に移動する。

```js
// Before (現状): 422 が先に来るので LLM parse error が "入力エラー" になる
if (status === 422 || status === 400) { ... }  // L82 ← ここで return してしまう
// ...
if (msg.includes('llm output parse') || ...) { ... }  // L96 ← 到達しない

// After (修正後): メッセージベースのチェックを先にする
if (msg.includes('llm output parse') || msg.includes('json parse error') || msg.includes('output validation failed')) {
  return { category: 'upstream', label: 'AI出力解析エラー', ... retryable: true }
}
if (status === 422 || status === 400) {
  return { category: 'invalid_input', label: '入力エラー', ... retryable: false }
}
```

### Step 2: バックエンド — LLM parse error を 502 に変更（根本修正）

**ファイル:** `tmp_market_lens_ai_repo/web/app/routers/review_routes.py` L173-175 (ad-lp), L136-141 (banner)

`AdLpReviewError` / `BannerReviewError` のうち、LLM出力パース失敗は入力検証ではなくサーバー側エラーなので 502 が適切。

```python
# review_routes.py — ad_lp_review handler
except AdLpReviewError as e:
    detail = str(e)
    if "LLM output parse" in detail or "output validation failed" in detail:
        raise HTTPException(status_code=502, detail=detail)
    raise HTTPException(status_code=422, detail=detail)
```

banner_review handler にも同様の修正を適用。

## 修正ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/api/marketLens.js` | `classifyError()` のチェック順序修正（L82-99） |
| `tmp_market_lens_ai_repo/web/app/routers/review_routes.py` | LLM parse error を 502 に分岐（L136-141, L173-175） |

## Verification

1. `npm run build` — ビルド成功を確認
2. フロントエンドの `classifyError()` に対して、422 + "LLM output parse failed" メッセージを渡した場合に `category: 'upstream'`, `retryable: true` が返ることを目視確認
3. バックエンド側テスト: `tmp_market_lens_ai_repo` で既存テストが通ることを確認
