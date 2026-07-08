# Discovery Hub: analyze エラーメッセージ誤分類の修正

## Context

Discovery Hub の `stage=analyze` で「Claude API のレート制限に達しました」と表示されるが、ユーザーは実際にはレート制限に引っかかっていない。Anthropic Console の残高は $9.38 で auto-reload も有効。

**根本原因:** `_humanize_analysis_error` 関数がエラーメッセージ文字列で `"rate limit"` を部分一致検索し、実際のエラー詳細を完全に隠している。

- Anthropic SDK のエラー文字列は `"Error code: 529 - {...'overloaded_error'...}"` のような形式
- 529 (Overloaded) でもメッセージ本文に "rate limit" が含まれると誤って「レート制限」に分類される
- RuntimeError に変換される過程で例外型（RateLimitError vs OverloadedError）が失われる

## 修正内容

### 1. `_humanize_analysis_error` をステータスコードベースに改修

**ファイル:**
- `tmp_market_lens_ai_repo/web/app/services/discovery/discovery_pipeline.py` L116-133
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py` L137-159（同一関数の重複）

**変更点:**
- エラー文字列から `"Error code: NNN"` パターンで HTTP ステータスコードを抽出
- 429 → レート制限、529 → 過負荷、として正しく分類
- 529 で "rate limit" 文字列が含まれていても「過負荷」と正しく判定
- **全ブランチで raw エラー詳細を `[...]` 付きで末尾に追記** → デバッグ可能に

```python
import re

_ERROR_CODE_RE = re.compile(r"Error code:\s*(\d+)")

def _humanize_analysis_error(provider_name, detail):
    normalized = detail.lower()
    suffix = f" [{detail[:200]}]" if detail else ""

    code_match = _ERROR_CODE_RE.search(detail)
    status_code = int(code_match.group(1)) if code_match else None

    if "x-api-key" in normalized or "api key" in normalized or "authentication" in normalized:
        return 401, f"Claude API キーが無効か、権限が不足しています。{suffix}"
    if status_code == 429 or ("rate limit" in normalized and status_code != 529):
        return 502, f"Claude API のレート制限に達しました。少し待って再試行してください。{suffix}"
    if status_code == 529 or "overloaded" in normalized:
        return 502, f"Claude API が過負荷状態です。少し待って再試行してください。{suffix}"
    if "credit" in normalized or "balance" in normalized or "billing" in normalized:
        return 502, f"Claude API のクレジット残高または請求設定を確認してください。{suffix}"
    if "quota" in normalized:
        return 502, f"Claude API の利用上限に達しました。{suffix}"
    if "model" in normalized and ("not found" in normalized or "invalid" in normalized
        or "access" in normalized or "available" in normalized or "unsupported" in normalized):
        return 502, f"Claude モデル設定またはモデル利用権限を確認してください。{suffix}"
    if detail:
        return 502, f"{provider_name} 呼び出しエラー: {detail[:240]}"
    return 502, f"{provider_name} の APIキーとモデル設定を確認してください。"
```

### 2. anthropic_client.py は変更しない

`RuntimeError(str(e)) from e` パターンは維持。`str(e)` にステータスコードが含まれているため、正規表現で抽出すれば十分。

## 実装順序

| Step | 内容 | ファイル |
|------|------|---------|
| 1 | `_humanize_analysis_error` 改修 | `discovery_pipeline.py` |
| 2 | 同一関数の重複を同様に改修 | `discovery_routes.py` |
| 3 | コミット & プッシュ（Render 自動デプロイ） | — |

## 検証方法

1. Render デプロイ後、Discovery Hub で URL を入力して「競合を発見」実行
2. エラーが出た場合、実際のエラー詳細が `[Error code: NNN - ...]` 形式で表示されることを確認
3. 529 エラーが「過負荷」と正しく分類されることを確認
