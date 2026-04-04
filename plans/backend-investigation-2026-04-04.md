# Backend Investigation Report — 2026-04-04

## 対象ブロッカー

| # | エンドポイント | 症状 | 起因 |
|---|--------------|------|------|
| 1 | `POST /api/discovery/analyze` | `500 Internal server error (SSLError)` | backend |
| 2 | `POST /api/reviews/banner` | `422 Could not process image` | backend + asset |
| 3 | CORS | `400 Disallowed CORS origin` for `127.0.0.1` | backend config |

---

## 1. Discovery API — 500 SSLError

### 根本原因

`discovery_routes.py` の `/analyze` パイプラインで、search ステップ (stage 7) の例外ハンドリングが不完全だった。

```python
# BEFORE: 2種類の例外しか catch していない
except asyncio.TimeoutError: ...
except SearchClientError: ...
# → ssl.SSLError 等の未知例外が global handler まで到達
```

`GeminiSearchClient._post_generate_content()` は httpx 例外を `SearchClientError` にラップするが、以下のケースで raw 例外が漏れる可能性があった:

- `ssl.SSLError` が httpx ラッパーを bypass するエッジケース
- Render 環境固有の TLS ハンドシェイク失敗
- google.genai SDK 経由の場合の非 httpx 例外

`_fetch_one()` (competitor LP fetch) でも `extract()` 等の呼び出しが try/except の外にあり、例外漏れの可能性があった。

### 修正内容

1. **search ステップに catch-all `except Exception` を追加**
   - `_sanitize_secret()` で API key をマスク
   - `_humanize_search_error()` で人間可読メッセージに変換
   - `(stage=search)` marker を付与
   - structured log に `error_type` を記録

2. **`_fetch_one()` に catch-all `except Exception` を追加**
   - `extract()` / screenshot 等の例外が `asyncio.gather` 経由でパイプライン全体を落とさないようにした
   - 該当 URL の fetch_error として記録し、次の候補に進む

### 修正ファイル

- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`

### Provider 起因の可能性

SSLError 自体は Render → Gemini API 間の TLS 接続問題の可能性が高い。
これは provider/infrastructure 起因であり、backend コードでは catch して適切なエラーメッセージに変換するのが限界。
根本解消には:
- Render 環境の CA 証明書バンドルの確認
- `DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC` の調整
- SSL verify の設定確認（`trust_env=False` が影響している可能性）

---

## 2. Creative Review API — 422 Could not process image

### 根本原因

guide asset `public/guide/page5-creative.png` の拡張子は `.png` だが、実体は JPEG バイナリ。

**エラーの連鎖:**

1. Frontend がファイルを upload → browser の `content_type` は拡張子ベースで `image/png`
2. Backend の `upload_asset()` は browser からの mime_type をそのまま保存
3. Review 時、`banner_review_service.py` が `meta.mime_type` ("image/png") で Claude multimodal API を呼び出す
4. Claude API は `media_type: image/png` + JPEG bytes の不一致を検出 → rejection
5. `banner_review_service.py` は `except Exception` で catch して text-only にフォールバック
6. text-only レビューは画像を見ずに生成 → 品質劣化 or validation 失敗 → `BannerReviewError` → 422

### 修正内容

1. **`asset_upload_service.py` に magic bytes 検証を追加**
   - PNG/JPEG/GIF/WebP の magic bytes を検査
   - declared mime type と実バイナリが不一致なら、detected type に自動修正
   - magic bytes が認識できない場合は `UploadError` で reject
   - これにより、以降の multimodal API 呼び出しで mime 不一致が発生しなくなる

2. **`banner_review_service.py` の multimodal fallback を改善**
   - 画像処理エラー (could not process, invalid image 等) の場合はサイレント fallback せず、明示的な `BannerReviewError` を返す
   - ネットワークエラーや一時的な障害の場合のみ text-only fallback を許可
   - エラーメッセージに `asset_id` と `mime_type` を含める

### 修正ファイル

- `tmp_market_lens_ai_repo/web/app/services/intake/asset_upload_service.py`
- `tmp_market_lens_ai_repo/web/app/services/review/banner_review_service.py`

### 補足

既にアップロード済みの不正 mime type アセットは修正されない。
既存アセットの修復が必要な場合は、再アップロードするか migration script が必要。

---

## 3. CORS — 127.0.0.1 が allowlist にない

### 根本原因

`main.py` の `_default_origins` に `http://localhost:3002` はあるが、`http://127.0.0.1:3002` / `http://127.0.0.1:3004` がなかった。

`localhost` と `127.0.0.1` は同じマシンでも **Origin ヘッダーとしては別の値** であり、CORS middleware は exact match で判定する。

### 修正内容

`_default_origins` に以下を追加:
- `http://127.0.0.1:3002`
- `http://127.0.0.1:3004`

### 修正ファイル

- `tmp_market_lens_ai_repo/web/app/main.py`

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `web/app/main.py` | CORS default origins に 127.0.0.1:3002/3004 追加 |
| `web/app/routers/discovery_routes.py` | search ステップ + fetch_one に catch-all 追加 |
| `web/app/services/intake/asset_upload_service.py` | magic bytes による mime type 自動修正 |
| `web/app/services/review/banner_review_service.py` | multimodal fallback の画像エラー判定改善 |

---

## 未解決事項と次のアクション

### SSLError の根本
- backend コードで catch はできるようになったが、Render → Gemini API 間の SSL 接続自体は provider/infrastructure 起因
- 確認すべき: Render の Python 環境の CA 証明書が最新か、`trust_env=False` の影響
- `gemini_search_client.py` の `httpx.AsyncClient(trust_env=False)` がシステムの proxy/cert 設定を無視している可能性

### 既存アセットの mime type 不整合
- 過去にアップロードされたアセットは修正されない
- 必要なら asset repository を走査して mime type を修正する migration が必要

### Frontend error 契約
- Discovery の error detail に `(stage=search)` / `(stage=brand_fetch)` / `(stage=fetch_competitors)` / `(stage=analyze)` が含まれる
- Frontend はこれを parse して stage-aware な表示に使える
- この契約は Phase 2 frontend の変更と整合する

### Production deploy
- これらの変更は backend repo (`market-lens-ai`) に反映して deploy する必要がある
- `tmp_market_lens_ai_repo` は local copy であり、production には自動反映されない
