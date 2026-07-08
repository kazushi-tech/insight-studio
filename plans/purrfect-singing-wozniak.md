# Fix: バナー再生成が元画像に戻る問題 — 修正版プラン

## Context

クリエイティブレビューで改善バナーを生成後、再生成すると**元のアップロード画像に戻り、スコアも低下する**問題。

### 根本原因

`handleGenerate` が常に**初回レビューの `runId`** を使用するため、バックエンドは毎回**元画像**を参照する。

### 重要な発見（元プランからの変更点）

**元プラン (hazy-mixing-giraffe.md) はバックエンドに `source_asset_id` パラメータを追加する設計だったが、これは不要。**

理由: `handleAfterScoring` は既に以下を実行している：
1. 生成画像をダウンロード → 新アセットとしてアップロード (`asset_id_B`)
2. `reviewBanner({ asset_id: asset_id_B })` でレビュー → 新 `run_id_2` を取得

バックエンドの `_load_review_result(run_id_2)` は `run.asset_id` = `asset_id_B`（生成画像）を返す。
つまり **新しい `run_id` を渡すだけで、バックエンドは自動的に生成画像を参照する。**

→ **フロントエンドのみの修正で解決可能。クロスリポ調整・デプロイ順序の考慮も不要。**

---

## 元プラン (hazy-mixing-giraffe.md) のレビュー結果

### Critical Issues

| # | 問題 | 影響度 |
|---|------|--------|
| 1 | **バックエンド変更は不要** — `afterReviewRunId` を渡せばバックエンドは自動的に生成画像を参照する。`source_asset_id` パラメータの追加は冗長 | 🔴 設計ミス |
| 2 | **クロスリポデプロイ順序の未考慮** — Pydantic `BaseModel` はデフォルトで未知フィールドを拒否する。新FEが `source_asset_id` を送ると旧BEで422エラー | 🔴 本番障害リスク |
| 3 | **`marketLens.js` API クライアント更新の欠落** — FEから `source_asset_id` を送る設計なのにAPIクライアントの変更が未記載 | 🟡 実装漏れ |

### Major Issues

| # | 問題 |
|---|------|
| 4 | `resetAll` に `afterReviewResult`, `afterError` の初期化が欠落（既存バグ） |
| 5 | `REGENERATION_THRESHOLD = 60` が `SCORE_THRESHOLD_GOOD` と重複（ハードコード） |
| 6 | Step 7 `GoodScoreMessage` の実装詳細（JSX配置、スタイリング、props）が不足 |
| 7 | `latestGenAssetId` state は `afterReviewRunId` で代替可能なため不要 |

---

## 修正版プラン

**変更対象: `src/pages/CreativeReview.jsx` のみ（1ファイル）**

### Step 1: `afterReviewRunId` state の追加

L492付近に追加:
```javascript
const [afterReviewRunId, setAfterReviewRunId] = useState(null)
```

> ⚠️ `latestGenAssetId` は不要（`afterReviewRunId` 経由でBEが自動解決）

### Step 2: `handleAfterScoring` で新 run_id を保存

[CreativeReview.jsx:698](src/pages/CreativeReview.jsx#L698) 付近、`setAfterReviewResult(review)` の後に追加:
```javascript
if (envelope.run_id) setAfterReviewRunId(envelope.run_id)
```

### Step 3: `handleGenerate` で最新の run_id を使用

[CreativeReview.jsx:642](src/pages/CreativeReview.jsx#L642) を変更:
```javascript
// Before:
const result = await generateBanner({ review_run_id: runId }, geminiKey.trim())

// After:
const effectiveRunId = afterReviewRunId || runId
const result = await generateBanner({ review_run_id: effectiveRunId }, geminiKey.trim())
```

依存配列に `afterReviewRunId` を追加。

> **APIクライアント (`marketLens.js`) の変更は不要** — `review_run_id` フィールドの値が変わるだけ。

### Step 4: `handleRegenerate` に `clearRun` を追加

[CreativeReview.jsx:668-673](src/pages/CreativeReview.jsx#L668-L673) を修正:
```javascript
const handleRegenerate = useCallback(() => {
  setRegenerationCount((c) => c + 1)
  setAfterReviewResult(null)
  setAfterError('')
  clearRun('banner-generation')          // ← 追加: 古いrun stateをクリア
  handleGenerate()
}, [handleGenerate, clearRun])
```

> `afterReviewRunId` は意図的にクリアしない（次回生成で使用するため）

### Step 5: `resetAll` の完全化

[CreativeReview.jsx:514-528](src/pages/CreativeReview.jsx#L514-L528) に追加:
```javascript
setAfterReviewResult(null)               // ← 追加（既存バグ修正）
setAfterError('')                        // ← 追加（既存バグ修正）
setAfterReviewRunId(null)                // ← 追加（新state初期化）
```

### Step 6: 閾値の定数統一

[CreativeReview.jsx:21](src/pages/CreativeReview.jsx#L21) を変更:
```javascript
// Before:
const REGENERATION_THRESHOLD = 60

// After:
const REGENERATION_THRESHOLD = SCORE_THRESHOLD_GOOD
```

`SCORE_THRESHOLD_GOOD` は L17 で既にインポート済み。

### Step 7: `GoodScoreMessage` コンポーネント追加

[CreativeReview.jsx:129](src/pages/CreativeReview.jsx#L129) 付近（`LowScoreRegenerationPrompt` の後）に追加:
```jsx
function GoodScoreMessage({ scores }) {
  const avg = calcAvgScore100(scores)
  if (avg < REGENERATION_THRESHOLD) return null
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-[0.75rem] p-4 flex items-center gap-2">
      <span className="material-symbols-outlined text-emerald-600">check_circle</span>
      <p className="text-sm text-emerald-800 font-medium japanese-text">
        改善バナーのスコアは {avg}/100 です。十分な品質が確認されました。
      </p>
    </div>
  )
}
```

JSX配置（L1015-1021付近）:
```jsx
{afterReviewResult?.rubric_scores && (
  <>
    <LowScoreRegenerationPrompt
      scores={afterReviewResult.rubric_scores}
      onRegenerate={handleRegenerate}
      regenerationCount={regenerationCount}
    />
    <GoodScoreMessage scores={afterReviewResult.rubric_scores} />
  </>
)}
```

> `LowScoreRegenerationPrompt` は avg < 60 で表示、`GoodScoreMessage` は avg >= 60 で表示。排他的に動作する。

---

## 修正対象ファイル一覧

| ファイル | リポ | 変更内容 |
|----------|------|----------|
| `src/pages/CreativeReview.jsx` | insight-studio | 全Step (1-7) |

**バックエンド変更: なし**

---

## Agent Team 戦略

**Agent Team は不要。** 理由:
- 変更対象が1ファイルのみで、全Stepが密結合
- 並列実行すると同一ファイルでconflictが発生
- 単一エージェントで順次実装が最適

---

## 検証方法

### 1. ビルド確認
```bash
npm run build
```

### 2. E2E手動テスト
| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | バナーアップロード → レビュー → 生成 | 改善バナーが生成される |
| 2 | After評価 → 再生成 | **生成画像ベース**で再生成される（元画像に戻らない） |
| 3 | 再生成後 → After評価 | スコアが前回生成画像の改善を反映 |
| 4 | スコア60以上 | `GoodScoreMessage` が表示される |
| 5 | スコア60未満 | `LowScoreRegenerationPrompt` が表示される |
| 6 | 再生成3回到達 | 上限メッセージ表示、ボタン無効化 |
| 7 | リセット | 全state（afterReviewResult, afterError, afterReviewRunId含む）がクリア |

### 3. バックエンド確認（変更なし、既存動作の確認）
- `_load_review_result(afterReviewRunId)` が生成画像の `asset_id` を返すことを確認
- DevTools Network タブで `review_run_id` が新しい値になっていることを確認
