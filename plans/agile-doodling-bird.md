# 本番エラー修正プラン — Discovery 404 + Creative Review スキーマエラー + バナー生成 UI 撤廃

## Context

Claude-Only マイグレーション完了後、本番環境 (insight-studio-chi.vercel.app) で以下のエラーが発生中:

1. **Discovery Hub: "Not Found" 404** — 「競合を発見」クリック時に 404
2. **Creative Review: Pydantic validation error** — レビュー実行時にスキーマ検証エラー
3. **バナー生成 UI 残存** — CreativeReview ページ内にまだ生成セクション・ボタン等が残っている可能性

---

## Bug 1: Discovery 404 "Not Found"

### Root Cause: poll_url のパス二重化

**Backend** (`discovery_routes.py:375`):
```python
poll_url=f"/api/discovery/jobs/{job_id}"  # ← /api 付き
```

**Frontend** (`marketLens.js:528`):
```javascript
poll_url: normalizeDiscoveryPollPath(data?.poll_url || data?.job_id)
```

`normalizeDiscoveryPollPath("/api/discovery/jobs/xxx")`:
- http で始まらない → line 509: `return '/discovery/jobs/' + '/api/discovery/jobs/xxx'`
- **結果**: パスが壊れる → `DIRECT_BACKEND_BASE + マングルされたパス` → 404

さらに、Render のデプロイ状態が不明。最新コードがデプロイされていない可能性もある。

### Fix

#### 1-A. Backend: poll_url から `/api` prefix を除去
**File**: `c:\Users\PEM N-266\work\market-lens-ai\web\app\routers\discovery_routes.py`
**Line 375**:
```python
# Before:
poll_url=f"/api/discovery/jobs/{job_id}",
# After:
poll_url=f"/discovery/jobs/{job_id}",
```

#### 1-B. Frontend: normalizeDiscoveryPollPath を堅牢に
**File**: `c:\Users\PEM N-266\work\insight-studio\src\api\marketLens.js`
**Lines 503-510**: poll_url が `/api/` で始まる場合に `/api` を strip する防御ロジック追加:
```javascript
function normalizeDiscoveryPollPath(jobIdOrPollPath) {
  if (!jobIdOrPollPath) return '/discovery/jobs/unknown'
  if (jobIdOrPollPath.startsWith('http://') || jobIdOrPollPath.startsWith('https://')) {
    const url = new URL(jobIdOrPollPath)
    return `${url.pathname}${url.search}`
  }
  // Already a relative path like "/discovery/jobs/xxx"
  if (jobIdOrPollPath.startsWith('/discovery/')) return jobIdOrPollPath
  // Legacy: "/api/discovery/..." — strip /api prefix
  if (jobIdOrPollPath.startsWith('/api/discovery/')) return jobIdOrPollPath.slice(4)
  // Bare job ID
  return `/discovery/jobs/${jobIdOrPollPath}`
}
```

#### 1-C. Render デプロイ確認
- Render ダッシュボードで最新 commit (`c203656`) がデプロイされているか確認
- デプロイされていない場合、手動デプロイを実行

### 検証
- ブラウザで Discovery Hub → URL 入力 → 「競合を発見」→ ジョブ開始 + ポーリング成功
- DevTools Network タブで `POST /api/discovery/jobs` → 202、`GET /api/discovery/jobs/{id}` → 200

---

## Bug 2: Creative Review Pydantic validation error

### Root Cause: プロンプトテンプレートに JSON コメントフィールドが含まれている

**File**: `c:\Users\PEM N-266\work\market-lens-ai\web\app\services\review\review_prompt_builder.py`
**Lines 47, 57**:
```json
"// good_points constraint": "minItems: 2 — 最低2件必須",
"// test_ideas constraint": "0件以上5件以下（任意）",
```

Claude がこれらを **そのまま JSON に出力** → `ReviewResult` (extra='forbid') が拒否 → エラー

### Fix

#### 2-A. プロンプトテンプレートからコメントフィールドを除去
**File**: `c:\Users\PEM N-266\work\market-lens-ai\web\app\services\review\review_prompt_builder.py`
**Lines 37-69**: `_OUTPUT_FORMAT_INSTRUCTIONS` を修正

```python
_OUTPUT_FORMAT_INSTRUCTIONS = """\
以下の JSON 形式で出力してください。JSON 以外のテキストは含めないでください。
コメントフィールド（"// ..." で始まるキー）は絶対に含めないでください。

制約:
- good_points: 最低 2 件必須
- test_ideas: 0〜5 件（任意）
- evidence: 0 件以上
- rubric_scores: 対象 rubric 項目すべて必須

{{
  "review_type": "{review_type}",
  "summary": "レビュー全体の要約（1-3文）",
  "product_identification": "画像から特定された製品・ブランド・キャンペーン名",
  "good_points": [
    {{"point": "良い点", "reason": "根拠"}}
  ],
  "keep_as_is": [
    {{"point": "変えない方がよい要素", "reason": "理由"}}
  ],
  "improvements": [
    {{"point": "改善点", "reason": "理由", "action": "具体的な行動ステップ"}}
  ],
  "test_ideas": [
    {{"hypothesis": "テスト仮説", "variable": "変更する変数", "expected_impact": "期待される効果（仮説として表現）"}}
  ],
  "evidence": [
    {{"evidence_type": "<{evidence_types}>のいずれか", "evidence_source": "出典元", "evidence_text": "引用テキスト"}}
  ],
  "target_hypothesis": "想定ターゲットの仮説",
  "message_angle": "訴求軸の要約",
  "rubric_scores": [
    {{"rubric_id": "<rubric項目ID>", "score": 1-5, "comment": "スコアの根拠コメント"}}
  ],
  "visible_text_elements": [
    {{"role": "headline/sub_copy/cta/price/note/brand_name", "text": "画像に表示されている正確なテキスト", "approximate_position": "top-left/center/bottom-right等"}}
  ]
}}"""
```

変更点:
- `"// good_points constraint"` 行を **削除**
- `"// test_ideas constraint"` 行を **削除**
- 制約は JSON の **外**（冒頭の散文セクション）に移動
- "コメントフィールドは含めない" と明示

### 検証
- CreativeReview → 画像アップロード → 「レビューを実行」→ 正常結果表示
- DevTools で POST /api/reviews/banner → 200、レスポンス JSON にコメントフィールドなし

---

## Bug 3: バナー生成 UI 完全撤廃

### 現状

CreativeReview.jsx にまだバナー生成関連のコード・UI が残存:
- Step 4 セクション「改善バナー（Optional / Experimental）」
- 生成ボタン、スコアリングボタン
- Nano Banana2 メタデータ
- ワークフローガイドに「バナー生成」ステップ
- エラーメッセージ「バナー生成に失敗しました」等

### Fix

#### 3-A. CreativeReview.jsx からバナー生成セクションを完全削除
**File**: `c:\Users\PEM N-266\work\insight-studio\src\pages\CreativeReview.jsx`

削除対象:
- `generateBanner` import (L12)
- バナー生成関連の state (`genRun`, `genResult`, etc.)
- `'banner-generation'` run kind の全処理
- Step 4 UI セクション全体（「改善バナー（Optional / Experimental）」）
- バナースコアリング関連のロジック・UI
- ワークフローガイドの「バナー生成」「保存」ステップ (L1132-1133)
- ヘッダーの「改善バナー生成は任意の追加ステップです。」テキスト (L773)
- エラーメッセージ「バナー生成に失敗しました」「改善バナー画像の取得に失敗しました」

#### 3-B. marketLens.js から generateBanner 関数を削除
**File**: `c:\Users\PEM N-266\work\insight-studio\src\api\marketLens.js`
- `generateBanner` export 削除 (L636-642)
- generation エンドポイントのエラーハンドリング削除 (L185)

#### 3-C. Layout.jsx から banner-generation ラベル削除
**File**: `c:\Users\PEM N-266\work\insight-studio\src\components\Layout.jsx`
- `'banner-generation': 'バナー生成'` 削除 (L289)

#### 3-D. Dashboard.jsx からバナー生成ステータス削除
**File**: `c:\Users\PEM N-266\work\insight-studio\src\pages\Dashboard.jsx`
- `creativeGenerationStatusLabel` 変数・表示削除 (L372, L433)

### 検証
- CreativeReview ページ: レビュー機能のみ表示、バナー生成セクションなし
- `npm run build` 成功
- `grep -r "改善バナー\|generateBanner\|banner-generation\|Nano Banana" src/` → ゼロ

---

## Agent Team 構成

```
         TEAM A (Backend: Discovery + Review)
         │  market-lens-ai
         │  - poll_url fix (Bug 1-A)
         │  - prompt template fix (Bug 2-A)
         │
         ├── 並列 ──┐
         │          │
         v          v
    TEAM B        TEAM C
    (Frontend:    (Frontend:
     Discovery)    バナー撤廃)
    insight-studio insight-studio
    - normalize    - CreativeReview
      fix (1-B)    - marketLens.js
                   - Layout/Dashboard
```

| Phase | Team | Repo | Scope | Files |
|-------|------|------|-------|-------|
| 1 | A | market-lens-ai | Backend fixes | 2 files |
| 2 | B | insight-studio | Discovery path fix | 1 file |
| 2 | C | insight-studio | バナー生成 UI 撤廃 | 4 files |
| 3 | Main | both | テスト + ビルド + 動作確認 | - |

### Commit 戦略

1. `fix(backend): remove /api prefix from discovery poll_url` (market-lens-ai)
2. `fix(backend): remove JSON comment fields from review prompt template` (market-lens-ai)
3. `fix(frontend): harden normalizeDiscoveryPollPath for various poll_url formats` (insight-studio)
4. `refactor(frontend): remove banner generation UI from CreativeReview` (insight-studio)

---

## 最終検証チェックリスト

- [ ] Discovery Hub: URL 入力 → 競合発見 → ジョブ完了まで正常動作
- [ ] Creative Review: バナーアップロード → レビュー実行 → 結果表示
- [ ] Creative Review: バナー生成セクションが存在しない
- [ ] Settings: Claude API key のみ表示（スクショで確認済み ✅）
- [ ] サイドバー: "改善バナー生成" 行がない（リロードで確認済み ✅）
- [ ] `npm run build` 成功
- [ ] `python -m pytest tests/ -q` 全 pass
- [ ] Render デプロイ成功確認
