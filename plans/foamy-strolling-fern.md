# Fix: 改善バナースコアリングの Evidence Grounding Violation エラー

## Context

改善バナー生成後の「改善バナーをスコアリング」ボタン押下時に、LLMが `evidence_source` に `"Google Ads ディスプレイ広告ベストプラクティス"` と記載し、`evidence_grounding_service.py` の `VAGUE_SOURCE_PATTERNS` 部分一致チェックに引っかかって `BannerReviewError` が発生する。

「ベストプラクティス」は曖昧表現として禁止されているが、LLMはGoogleの公式ドキュメント名として使っている。プロンプトの指示が不十分で、evidence_source に使ってはいけない具体的な単語リストが明示されていない。

## 修正方針

**プロンプト強化 + バリデーション改善** の2段構え。

### Step 1: プロンプト強化（`review_prompt_builder.py`）

`_STYLE_RULES` のルール5とルール9を強化して、evidence_source に使ってはいけない語句を明示し、代替表現を例示する。

**修正ファイル:** `market-lens-ai/web/app/services/review/review_prompt_builder.py`

現在のルール5:
```
5. evidence には必ず具体的なソースを記載する。「一般的に」「通常は」等の曖昧表現は使わない
```

強化後:
```
5. evidence_source には具体的なソース名を記載する。以下の語句を含む表現は禁止:
   「一般的に」「通常」「普通は」「業界では」「ベストプラクティス」「研究によると」「データで証明」「専門家によれば」
   NG例: "Google Ads ディスプレイ広告ベストプラクティス"
   OK例: "Google Ads ヘルプ - ディスプレイ広告の要件と推奨事項", "当バナー画像内の視覚要素の観察"
```

### Step 2: バリデーション改善（`evidence_grounding_service.py`）

現状の部分一致チェックをそのまま維持しつつ、LLMがルールを破った場合のリトライ機構を `banner_review_service.py` に追加する。

**修正ファイル:** `market-lens-ai/web/app/services/review/banner_review_service.py`

- Evidence grounding violation 発生時に1回だけリトライ（エラーメッセージをプロンプトに追記して再実行）
- 2回目も失敗したらエラーを返す

### Step 3: フロントエンドのエラー表示改善（optional）

**修正ファイル:** `src/pages/CreativeReview.jsx`

- 現状のエラーメッセージをそのまま表示するのではなく、ユーザーフレンドリーなメッセージに変換
- 「スコアリングに失敗しました。再試行してください。」のような表示に

## 修正対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `market-lens-ai/web/app/services/review/review_prompt_builder.py` | ルール5のevidence_source禁止語句明示 |
| `market-lens-ai/web/app/services/review/banner_review_service.py` | grounding violation時の1回リトライ |
| `src/pages/CreativeReview.jsx` | エラーメッセージのユーザーフレンドリー化（optional） |

## Verification

1. market-lens-aiのテスト実行: `cd market-lens-ai && python -m pytest tests/ -v`
2. 改善バナーのスコアリングを実行して成功することを確認
3. プロンプトの禁止語句リストが `VAGUE_SOURCE_PATTERNS` と一致していることを確認
