# Fix: バナー再生成が元画像に戻る問題 + 初回品質向上

## Context

クリエイティブレビューで改善バナーを生成後、再生成すると**元のアップロード画像に戻り、スコアも低下する**深刻な問題。
原因は3つ:
1. バックエンドが常に**元画像**を参照し、生成済み画像を無視
2. フロントエンドの再生成時に**stateが未クリア**で古いデータが残る
3. After評価の`run_id`が再生成に渡されず、改善提案が元レビューのまま

ユーザーの要望: 初回で60-70点のバナーを生成し、無限ループでAPI料金を浪費させない。

---

## Plan

### Step 1: Backend — `source_asset_id` パラメータ追加

**目的**: 再生成時に最新の生成画像をベースにできるようにする

**File**: `market-lens-ai/web/app/schemas/banner_generation.py`
- `BannerGenRequest` に `source_asset_id: Optional[str] = None` を追加
- 後方互換: デフォルトNoneで既存呼び出しに影響なし

**File**: `market-lens-ai/web/app/routers/generation_routes.py` (L42-77)
- `req.source_asset_id` が指定されたら、元のasset_idの代わりにそちらを使用
- レビュー結果(プロンプト文脈)は `review_run_id` から取得(変更なし)
- 参照画像だけを差し替える

```python
# L53の後に追加
effective_asset_id = req.source_asset_id or asset_id
# L59-66で asset_id → effective_asset_id に置換
```

### Step 2: Frontend — 再生成用state追跡の追加

**File**: `insight-studio/src/pages/CreativeReview.jsx`

新しいstate変数を追加:
```javascript
const [afterReviewRunId, setAfterReviewRunId] = useState(null)
const [latestGenAssetId, setLatestGenAssetId] = useState(null)
```

### Step 3: Frontend — `handleAfterScoring` で新IDを保存

**File**: `insight-studio/src/pages/CreativeReview.jsx` (L676-711)

`handleAfterScoring` 内で:
- `uploadCreativeAsset` の戻り値から `asset_id` を `latestGenAssetId` に保存
- `reviewBanner` の戻り値(envelope)から `run_id` を `afterReviewRunId` に保存

```javascript
const uploadData = await uploadCreativeAsset(file)
setLatestGenAssetId(uploadData.asset_id)  // NEW

const envelope = await reviewBanner(...)
const review = envelope.review || envelope
setAfterReviewResult(review)
if (envelope.run_id) setAfterReviewRunId(envelope.run_id)  // NEW
```

### Step 4: Frontend — `handleGenerate` を修正

**File**: `insight-studio/src/pages/CreativeReview.jsx` (L633-666)

再生成時に最新のrun_idとsource_asset_idを使用:
```javascript
const effectiveRunId = afterReviewRunId || runId
const result = await generateBanner(
  { review_run_id: effectiveRunId, source_asset_id: latestGenAssetId },
  geminiKey.trim()
)
```

依存配列に `afterReviewRunId`, `latestGenAssetId` を追加。

### Step 5: Frontend — `handleRegenerate` のstate修正

**File**: `insight-studio/src/pages/CreativeReview.jsx` (L668-673)

`clearRun('banner-generation')` を追加して古いrun stateをクリア:
```javascript
const handleRegenerate = useCallback(() => {
  setRegenerationCount((c) => c + 1)
  setAfterReviewResult(null)
  setAfterError('')
  clearRun('banner-generation')  // NEW
  handleGenerate()
}, [handleGenerate, clearRun])
```

### Step 6: Frontend — `resetAll` にnew stateの初期化を追加

**File**: `insight-studio/src/pages/CreativeReview.jsx` (L514-528)

```javascript
setAfterReviewRunId(null)
setLatestGenAssetId(null)
```

### Step 7: UX改善 — 良スコア時の完了メッセージ

**File**: `insight-studio/src/pages/CreativeReview.jsx`

スコアが60以上のとき「十分な品質です」と表示し、再生成を促さない。
既存の`LowScoreRegenerationPrompt`がスコア60未満のみ表示されるので、
逆にスコア60以上のとき完了メッセージを表示する`GoodScoreMessage`コンポーネントを追加。

---

## 修正対象ファイル一覧

| ファイル | リポ | 変更内容 |
|----------|------|----------|
| `web/app/schemas/banner_generation.py` | market-lens-ai | `source_asset_id` フィールド追加 |
| `web/app/routers/generation_routes.py` | market-lens-ai | `effective_asset_id` ロジック |
| `src/pages/CreativeReview.jsx` | insight-studio | state追跡・再生成修正・UX改善 |

## 検証方法

1. **バックエンドテスト**: `source_asset_id` なしで既存動作確認、ありで新画像参照を確認
2. **フロントエンド手動テスト**:
   - バナーアップロード → レビュー → 生成 → After評価 → 再生成
   - 再生成後のバナーが前回生成画像ベースであることを確認(元画像に戻らない)
   - スコア60以上で完了メッセージ表示確認
   - resetAll後にstateがクリアされていることを確認
3. **npm run build** でビルドエラーなしを確認
