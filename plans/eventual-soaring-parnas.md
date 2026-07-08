# Fix: 改善バナースコアリング時のmime_type不一致エラー

## Context

改善バナー（AFTER）をスコアリングする際、Anthropic APIが以下のエラーを返す：

```
The image was specified using the image/png media type,
but the image appears to be a image/jpeg image
```

**根本原因:** フロントエンドが生成画像を再アップロードする際、実際の画像形式に関わらず `{ type: 'image/png' }` をハードコードしている。Gemini Visionが返す画像はJPEGの可能性があるが、システム全体を通じて `image/png` として扱われてしまう。

### エラー経路

```
1. Gemini Vision生成 → 実際はJPEG bytesを返す（inline_data.mime_type を無視）
2. generation_routes.py:114 → Response(..., media_type="image/png") で固定
3. Frontend fetch → blob.type は "image/png"（レスポンスヘッダーから）
4. CreativeReview.jsx:706 → new File([blob], name, { type: 'image/png' }) で二重固定
5. Asset Upload → mime_type="image/png" で保存
6. Banner Review → Anthropic API が「実際はJPEG」と拒否
```

### 用語定義

- **`mime_type`**: Gemini API の `inline_data.mime_type` から取得する値
- **`image_mime_type`**: BannerGenResult スキーマに追加するフィールド名

---

## 変更対象

| ファイル | リポ | 変更内容 |
|----------|------|----------|
| `web/app/gemini_vision_client.py` | market-lens-ai | inline_data.mime_type を返すように修正 |
| `web/app/services/generation/banner_gen_service.py` | market-lens-ai | 生成結果に image_mime_type を保持 |
| `web/app/routers/generation_routes.py` | market-lens-ai | 実際の mime_type で Response 返却 |
| `web/app/schemas/banner_generation.py` | market-lens-ai | BannerGenResult に image_mime_type フィールド追加 |
| `src/pages/CreativeReview.jsx` | insight-studio | fetch レスポンスの Content-Type を使用 |

---

## 修正プラン

### Step 1: Gemini Vision Client で mime_type を返す

**ファイル:** `market-lens-ai/web/app/gemini_vision_client.py`

**Before (line 74-75):**
```python
if part.inline_data is not None:
    return part.inline_data.data
```

**After:**
```python
if part.inline_data is not None:
    mime_type = part.inline_data.mime_type or "image/png"
    return part.inline_data.data, mime_type
```

**関数シグネチャ変更:**
```python
async def call_gemini_vision(...) -> tuple[bytes, str]:
    """Returns (image_bytes, mime_type)."""
```

### Step 2: BannerGenResult スキーマに image_mime_type を追加

**ファイル:** `market-lens-ai/web/app/schemas/banner_generation.py`

**追加 (line 39 の後):**
```python
class BannerGenResult(BaseModel):
    # ... existing fields ...
    image_mime_type: str | None = None  # 追加: 生成画像の実際のMIMEタイプ
```

### Step 3: BannerGenService で image_mime_type を保持

**ファイル:** `market-lens-ai/web/app/services/generation/banner_gen_service.py`

**変更点 (line 107-112):**
```python
# Before
image_bytes = await call_gemini_vision(...)

# After
image_bytes, image_mime_type = await call_gemini_vision(
    prompt=prompt,
    model=model,
    api_key=api_key,
    reference_image=original_image,
)
```

**変更点 (line 121-128): result.model_copy の update に追加):**
```python
result = result.model_copy(
    update={
        "status": BannerGenStatus.completed,
        "image_path": str(img_path),
        "image_url": f"/api/generation/{gen_id}/image",
        "image_mime_type": image_mime_type,  # 追加
        "completed_at": completed_at,
    }
)
```

**Note:** `_image_path()` の拡張子は変更しない。保存ファイル名は `banner.png` で統一し、mime_type はスキーマ経由で伝播させる。（理由: ファイルシステムの複雑化を避けるため）

### Step 4: Generation Route で正しい Content-Type を返す

**ファイル:** `market-lens-ai/web/app/routers/generation_routes.py:114`

**Before:**
```python
return Response(content=image_bytes, media_type="image/png")
```

**After:**
```python
mime_type = result.image_mime_type or "image/png"
return Response(content=image_bytes, media_type=mime_type)
```

### Step 5: Frontend で Content-Type ヘッダーを使用

**ファイル:** `insight-studio/src/pages/CreativeReview.jsx:703-706`

**Before:**
```javascript
const resp = await fetch(genImageUrl)
if (!resp.ok) throw new Error('改善バナー画像の取得に失敗しました。')
const blob = await resp.blob()
const file = new File([blob], `improved-${genId}.png`, { type: 'image/png' })
```

**After:**
```javascript
const resp = await fetch(genImageUrl)
if (!resp.ok) throw new Error('改善バナー画像の取得に失敗しました。')
const blob = await resp.blob()
// blob.type が image/jpeg のみ特別扱い、それ以外は image/png として扱う
// Note: Gemini Vision は image/jpeg または image/png を返す
const actualType = blob.type || 'image/png'
const ext = actualType === 'image/jpeg' ? 'jpg' : 'png'
const file = new File([blob], `improved-${genId}.${ext}`, { type: actualType })
```

**エッジケース対応:** `image/gif` や `image/webp` が返ってきた場合は `png` として扱う。これは Gemini Vision の仕様上発生しないはずだが、安全側に倒す。

---

## 検証方法

### 1. 単体テスト（market-lens-ai）
```bash
cd "c:\Users\PEM N-266\work\market-lens-ai"
python -m pytest tests/test_gemini_vision_client.py -v
python -m pytest tests/test_banner_gen_service.py -v
```

### 2. E2E手動テスト

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | バナーアップロード → レビュー → 生成 | 生成画像が表示される |
| 2 | 生成画像のネットワークタブ確認 | Content-Type が実際の形式と一致（image/jpeg または image/png） |
| 3 | JPEG画像で生成テスト | blob.type === 'image/jpeg'、拡張子 .jpg でアップロード |
| 4 | PNG画像で生成テスト | blob.type === 'image/png'、拡張子 .png でアップロード |
| 5 | スコアリング実行 | mime_typeエラーが出ず、正常にスコア表示 |

### 3. デプロイ順序

**重要:** 以下の順序でデプロイすること

1. **market-lens-ai** を先にデプロイ（API変更）
   - この時点ではmime_typeは常に `image/png` または正しい値が返る
   - フロントエンドはまだ `image/png` 固定だが、エラーは発生しない

2. **insight-studio** を後にデプロイ（フロントエンド追従）
   - これで完全に正しいmime_typeが伝播する

### 4. ロールバック手順

問題が発生した場合は以下の順序でロールバック：

1. **insight-studio** を先にロールバック（前のバージョンに戻す）
2. **market-lens-ai** を後にロールバック

**理由:** フロントエンドが古い状態（`image/png` 固定）でも、バックエンドが新しい状態（正しいmime_type返却）なら、スコアリングは成功する（フロントエンドが `image/png` として扱うだけ）。逆順でロールバックすると、バックエンドが `image/png` 固定に戻った時点で元の問題が再発する可能性がある。

---

## タスク規模

中規模（4ファイル変更 + スキーマ1ファイル）。単一エージェントで実装可能。
