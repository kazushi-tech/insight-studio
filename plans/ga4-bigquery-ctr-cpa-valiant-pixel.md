# AI考察「接続失敗」— 真の根本原因と hotfix

## Context

PR #77 (commit 03a697f5) で 6 Phase 修正を実施したが、**本番で依然「ネットワークエラー。バックエンドへの接続に失敗しました」が発生**。わらわの curl 実測で真犯人を特定した。

## 真の根本原因

backend CORS `allow_headers` リストに **`X-Analysis-Provider` が未登録**。

- backend_api.py: `allow_headers=["Content-Type", "X-Client-ID", "X-Gemini-API-Key", "Accept", "Authorization"]`
- frontend adsInsights.js `neonGenerate()`: `payload.provider` があれば `X-Analysis-Provider` を送信

→ browser は preflight OPTIONS で `Access-Control-Request-Headers: x-analysis-provider,...` を送る
→ backend CORSMiddleware が **400 "Disallowed CORS headers"** を返す
→ browser は `Failed to fetch` → classifyError が `network` → 「ネットワークエラー。バックエンドへの接続に失敗しました。」

**実測**:
```
$ curl -X OPTIONS https://market-lens-ai.onrender.com/api/ads/neon/generate \
    -H "Origin: https://insight-studio-chi.vercel.app" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type,authorization,x-analysis-provider,x-client-id"

HTTP/1.1 400 Bad Request
Disallowed CORS headers
```

Phase 1 の CORSMiddleware 最外層化は正しかったが、**allow_headers リスト自体が不完全**ゆえ preflight で 400 落ちしとった。

## Fix（1 行）

[backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) L5944-5951 `app.add_middleware(CORSMiddleware, ...)` の allow_headers に `"X-Analysis-Provider"` を追加。

```python
allow_headers=[
    "Content-Type",
    "X-Client-ID",
    "X-Gemini-API-Key",
    "X-Analysis-Provider",  # ← 追加
    "Accept",
    "Authorization",
],
```

## 検証

```bash
# preflight 成功確認
curl -i -X OPTIONS https://market-lens-ai.onrender.com/api/ads/neon/generate \
  -H "Origin: https://insight-studio-chi.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization,x-analysis-provider,x-client-id"
# → 200 OK、allow-headers に X-Analysis-Provider を含む
```

本番 `/ads/ai` でクイックプロンプト送信 → 「ネットワークエラー」消滅 + 正常応答 or 正しいエラー分類表示。

## 実行手順

1. fix branch 切る
2. allow_headers に `X-Analysis-Provider` 追加
3. commit → push → PR 作成 → merge
4. Render 自動デプロイ待機
5. curl で preflight 200 確認
6. 本番 `/ads/ai` で最終確認
