# Ad-LP レビュー品質改善プラン

## Context

Creative Review の「広告+LP統合レビュー」が全項目 1/5 のゴミレビューを返す問題。
スクリーンショット確認の結果、**3つの致命的なバグ**が根本原因と判明:

1. **バナー画像がLLMに送られていない** — `ad_lp_fit_service.py` が `call_text_model`（テキスト専用）のみ使用。LLMはファイル名と寸法しか見えず、画像の中身を一切分析できない
2. **LP取得タイムアウト 8秒** — 日本ECサイトには短すぎて全フィールド「取得不可」になる
3. **データ不足時のプロンプト指示がない** — LLMが「評価不能」と「品質が悪い」を区別できず、全項目1点をつける

---

## Fix 1: マルチモーダル画像送信 (CRITICAL)

`banner_review_service.py` のパターンに倣い、ad-LPレビューでも画像を送る。

### File: `tmp_market_lens_ai_repo/web/app/services/review/ad_lp_fit_service.py`

**a) import追加 (line 11)**
```python
from ...llm_client import call_multimodal_model as _call_multimodal_model
from ...llm_client import call_text_model as _call_text_model
```

**b) 画像読み込み (line 57の後、LP capture前)**
```python
image_data = repo.load_data(asset_id)
```

**c) LLMコール変更 (lines 96-102)** — `banner_review_service.py` lines 97-132 と同一パターン:
- `image_data is not None` → `_call_multimodal_model()` で画像送信
- multimodal例外時 → 画像固有エラーなら `AdLpReviewError` raise、それ以外は `_call_text_model()` fallback
- `image_data is None` → `_call_text_model()` fallback

### File: `tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py`

**d) `build_ad_lp_review_prompt()` にバナー画像分析指示を追加 (line 209の後)**
```
## 重要: バナーの視覚要素分析
提供されたバナー画像から、以下を読み取り LP との整合性を評価してください:
- 画像内のテキスト（ヘッドライン、キャッチコピー、CTA、価格表示等）
- 配色・視覚階層・デザイン要素
- 訴求軸やターゲット推測の根拠となるビジュアル情報
```

---

## Fix 2: LP取得タイムアウト改善

### File: `tmp_market_lens_ai_repo/web/app/services/review/ad_lp_fit_service.py`

```python
_LP_CAPTURE_TIMEOUT_SEC = 20.0   # 8.0 → 20.0（日本ECサイト対応）
_LP_CAPTURE_MAX_RETRIES = 2      # 1 → 2
```

### File: `tmp_market_lens_ai_repo/web/app/services/intake/landing_page_capture_service.py`

**a) trust_elements に testimonials をマッピング (line 54)**
```python
trust_elements=data.testimonials[:5] if data.testimonials else [],
```
`extractor.py` の `_extract_testimonials()` は既に実装済み（line 302）。

**b) 抽出結果の品質ログ追加 (line 55の後)**
```python
has_meaningful_data = any([lp_input.title, lp_input.first_view_text,
                           lp_input.cta_text, lp_input.meta_description])
if not has_meaningful_data:
    logger.warning("LP extraction yielded no data for %s (likely JS-rendered)", url)
```

---

## Fix 3: データ不足時のプロンプト強化

### File: `tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py`

**a) `build_ad_lp_review_prompt()` 内でLP取得状況を判定し、条件付き指示を挿入**

LP fieldsの充足度をチェックし、不足時に以下のブロックを追加:
```
## LP データ取得状況に関する注意
LP の一部フィールドが「取得不可」です。技術的な取得制限が原因であり、LP品質の問題ではありません。

採点ルール:
- 「取得不可」フィールドに依存する項目は、取得できた情報のみで判断する
- データ不足の項目は 3（標準）をベースラインとし、取得できた証拠で上下させる
- 「データ不足」を理由にスコア 1-2 を付けることは禁止
- 代わりに comment に「LP データ取得制限により限定的な評価」と明記する
```

**b) 常時適用の指示追加（"重要な評価ポイント" セクション内）:**
```
- スコア 1 は「致命的欠陥がある」場合のみ使用。データ不足を理由に 1 を付けないこと
- 広告バナーの視覚情報を必ず分析に含めること（画像が提供されている場合）
```

---

## Fix 4: テスト更新

### File: `tests/test_ad_lp_fit_service.py`

| テスト | 内容 |
|--------|------|
| `test_success` 更新 | mock を `_call_multimodal_model` に変更 |
| `test_multimodal_fallback` 新規 | multimodal例外時にtext fallbackを確認 |
| `test_image_none_uses_text` 新規 | `repo.load_data` が None → text-only確認 |
| `test_invalid_llm_output` 更新 | mock を `_call_multimodal_model` に変更 |

### File: `tests/test_banner_review_service.py`（参照パターン）
- `test_multimodal_fallback_on_non_image_error` (line 221)
- `test_text_only_when_no_image_data` (line 250) — 同一パターンを踏襲

### File: `tests/test_ad_lp_fit_service.py`（プロンプトテスト）
| テスト | 内容 |
|--------|------|
| `test_partial_lp_data_prompt_warning` 新規 | URL+titleのみ → 警告テキスト含む |
| `test_full_lp_data_no_warning` 新規 | 全フィールド充足 → 警告テキスト不含 |

---

## 変更ファイル一覧

| File | 変更内容 |
|------|----------|
| `tmp_market_lens_ai_repo/web/app/services/review/ad_lp_fit_service.py` | multimodal対応 + timeout増 |
| `tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py` | 画像分析指示 + データ不足ガイダンス |
| `tmp_market_lens_ai_repo/web/app/services/intake/landing_page_capture_service.py` | trust_elements + 品質ログ |
| `tmp_market_lens_ai_repo/tests/test_ad_lp_fit_service.py` | mock更新 + 新規テスト |

---

## 検証手順

1. `cd tmp_market_lens_ai_repo && .venv/Scripts/python -m pytest tests/ -x -q` — 全テスト合格
2. `cd insight-studio && npm run build` — ビルド成功
3. backend push → Render deploy
4. 本番確認: 同じバナー + LP URL (`https://hits-online.jp/campaign/cielo-lucano-campaign`) で再テスト
   - summaryに画像の視覚的分析が含まれるか
   - LPフィールドが取得されているか
   - スコアが2-5のレンジに分布するか（全1でない）
