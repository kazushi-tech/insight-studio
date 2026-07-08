# Fix: バナーレビューで画像が認識されず全スコア1.0になる問題

## Context

クリエイティブレビューでバナー画像をアップロード・レビュー実行すると、**全スコアが1.0/5**になり、要約に「広告バナーの画像が提供されておらず」と表示される。画像アップロード自体は成功している（asset_id取得済み）。

### 根本原因

**`banner_review_service.py:109-126` のサイレント text-only フォールバック。**

```python
if image_data is not None:
    try:
        raw_text, _usage = await call_gemini_multimodal(...)
    except Exception:                    # ← 全例外を握りつぶし
        logger.warning("Multimodal call failed for asset %s, falling back to text-only", asset_id)
        raw_text, _usage = await call_gemini(prompt, ...)   # ← 画像なしで実行
```

マルチモーダルLLM呼び出しが**何らかの理由で失敗**すると、`except Exception` で全例外をキャッチし、**画像なしのテキストのみ**でLLMを再実行する。LLMはプロンプト中のファイル名・サイズ情報のみ受け取り、実画像が見えないため「画像が提供されていない」と判断 → 全項目1.0を返す。

**バナーレビューにおいて text-only フォールバックは無意味** — 画像が見えなければレビューは不可能。サイレントに低品質な結果を返すより、明確にエラーを返すべき。

### マルチモーダル失敗の推定原因

サーバーログで特定可能:
1. **Claude APIのモデル名/アクセス問題** — BYOK APIキーがマルチモーダルモデルにアクセスできない
2. **API接続エラー** — Render→Anthropic間のネットワーク問題（※`anthropic_client.py` に接続リトライ3回あり）
3. **画像サイズ/フォーマット問題** — base64エンコード後のサイズがAPI制限超過
4. **レート制限** — Anthropic APIのrate limit

### リトライについて

`anthropic_client.py:37` に `_MAX_CONNECT_RETRIES = 3`（指数バックオフ付き）が既に実装済み。接続エラーは自動リトライされるため、追加のリトライロジックは不要。レート制限は上流側（Anthropic SDK）が429を返すため、ユーザーに「少し待ってリトライ」と伝えるのが適切。

---

## 変更対象

| ファイル | リポ | 変更内容 |
|----------|------|----------|
| `web/app/services/review/banner_review_service.py` | **market-lens-ai** | text-onlyフォールバック削除、エラー伝播 |

> **⚠️ 作業リポジトリ:** `c:\Users\PEM N-266\work\market-lens-ai`（insight-studioではない）

### 変更不要の確認済みファイル

| ファイル | リポ | 理由 |
|----------|------|------|
| `web/app/services/review/ad_lp_fit_service.py` | market-lens-ai | フォールバックパターンなし（text-only直接呼び出しのみ） |
| `web/app/routers/review_routes.py:133-135` | market-lens-ai | `BannerReviewError` → HTTP 422 + `detail=str(e)` で正しくマッピング済み |
| `src/api/marketLens.js` | insight-studio | `buildErrorMessage` line 94: `if (cleanedDetail) return cleanedDetail` でサーバーのdetailが優先表示される。422の汎用メッセージより先に評価されるため、バックエンドのエラーメッセージはそのままユーザーに表示される |

---

## 修正プラン

### Step 1: サイレントフォールバックの除去

**ファイル:** `market-lens-ai/web/app/services/review/banner_review_service.py:109-133`

**Before:**
```python
if image_data is not None:
    try:
        raw_text, _usage = await call_gemini_multimodal(
            prompt,
            image_data=image_data,
            mime_type=meta.mime_type or "image/png",
            provider=provider,
            model=model,
            api_key=api_key,
        )
    except Exception:
        logger.warning("Multimodal call failed for asset %s, falling back to text-only", asset_id)
        raw_text, _usage = await call_gemini(
            prompt,
            provider=provider,
            model=model,
            api_key=api_key,
        )
else:
    raw_text, _usage = await call_gemini(
        prompt,
        provider=provider,
        model=model,
        api_key=api_key,
    )
```

**After:**
```python
if image_data is None:
    raise BannerReviewError(
        "Asset image data could not be loaded. "
        f"asset_id={asset_id} exists in metadata but binary data is missing."
    )

try:
    raw_text, _usage = await call_gemini_multimodal(
        prompt,
        image_data=image_data,
        mime_type=meta.mime_type or "image/png",
        provider=provider,
        model=model,
        api_key=api_key,
    )
except Exception as exc:
    logger.error(
        "Multimodal LLM call failed for asset %s: %s",
        asset_id, exc, exc_info=True,
    )
    raise BannerReviewError(
        f"画像付きレビューの実行に失敗しました: {exc}"
    ) from exc
```

**変更点:**
- `image_data is None` → フォールバックせず明確なエラーを投げる
- マルチモーダル失敗時は例外を re-raise（`exc_info=True` でスタックトレースをログ出力）
- `except Exception` → `except Exception as exc` で例外情報を保持
- ユーザーに「画像付きレビュー失敗」という明確なメッセージを返す
- `BannerReviewError` は既存クラス（line 55-56）、ルートハンドラで HTTP 422 + detail にマッピングされる

### Step 2: テスト追加（推奨）

**ファイル:** `market-lens-ai/tests/test_banner_review_service.py`

既存テストはフォールバック動作をカバーしていない（成功ケース・asset未発見・不正LLM出力の3件のみ）。以下のテストを追加:

```python
@pytest.mark.asyncio
async def test_multimodal_failure_raises_error(self, ...):
    """マルチモーダル呼び出し失敗時にBannerReviewErrorがraiseされること"""
    # call_gemini_multimodal をモックして例外を投げる
    # review_banner が BannerReviewError を raise することを確認
    # call_gemini（text-only）が呼ばれないことを確認

@pytest.mark.asyncio
async def test_missing_image_data_raises_error(self, ...):
    """image_data=None 時にBannerReviewErrorがraiseされること"""
    # image_data を None にして呼び出し
    # BannerReviewError が raise されることを確認
```

---

## 検証方法

### 1. テスト実行
```bash
cd "c:\Users\PEM N-266\work\market-lens-ai"
python -m pytest tests/test_banner_review_service.py -v
```

### 2. インポート確認
```bash
cd "c:\Users\PEM N-266\work\market-lens-ai"
python -c "from web.app.services.review.banner_review_service import review_banner; print('import ok')"
```

### 3. E2E手動テスト

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | バナーアップロード → Claude でレビュー | 画像が認識され正常なスコア（1.0より高い）が返る |
| 2 | マルチモーダル失敗時（APIキー無効等） | 「画像付きレビューの実行に失敗しました: ...」エラーが表示される（全1.0の無意味な結果ではない） |
| 3 | asset_id は有効だが画像データ欠損時 | 「binary data is missing」エラーが表示される |

### 4. エラー表示経路の確認

```
Backend: BannerReviewError("画像付きレビューの実行に失敗しました: ...")
    ↓ review_routes.py:133-135
HTTPException(status_code=422, detail="画像付きレビューの実行に失敗しました: ...")
    ↓ HTTP response
Frontend: requestJson → buildErrorMessage(path, 422, body)
    ↓ marketLens.js:94 — if (cleanedDetail) return cleanedDetail
ユーザーに表示: "画像付きレビューの実行に失敗しました: ..."
```

### 5. デプロイ
```bash
cd "c:\Users\PEM N-266\work\market-lens-ai"
git add web/app/services/review/banner_review_service.py
git commit -m "fix: remove silent text-only fallback in banner review"
git push origin main
```
Render 自動デプロイ → insight-studio から再テスト

---

## タスク規模の判定

本修正は **1ファイルの局所的変更**（+ テスト追加1ファイル）のため、Agent Teams / 並列実行は不要。通常の単一エージェント作業で十分。
