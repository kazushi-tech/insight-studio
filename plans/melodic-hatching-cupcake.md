# Plan: Creative Review + Discovery Hub エラー修正

## Context

2026-04-10、Creative ReviewとDiscovery Hubの2つの機能で実行時エラーが発生。
昨日は正常動作していたが今日は動かない状態。ユーザーから「徹底的に対応」の要望。

**エラー1**: Creative Review → `Review output validation failed: Missing rubric IDs: ['drop_off_risk', 'input_friction', 'story_consistency']`
**エラー2**: Discovery Hub → `分析がタイムアウトしました。再試行してください。`

---

## エラー1: Creative Review — ルーブリックID欠落

### 根本原因
バックエンドバリデータ ([review_output_validator.py:196-200](tmp_market_lens_ai_repo/web/app/services/review/review_output_validator.py#L196-L200)) が、期待する全ルーブリックIDの存在を厳密チェック。AIがLP依存項目 (`drop_off_risk`, `input_friction`, `story_consistency`) を `score: null` で出力すべきところを、項目ごと省略することがある。

### 修正内容

#### 1A. バリデータの自動補完（主修正）
**ファイル**: [review_output_validator.py](tmp_market_lens_ai_repo/web/app/services/review/review_output_validator.py)

- `missing` を2グループに分割:
  - `missing_lp_dep` → LP依存ID → `score: null` で自動補完（warning）
  - `missing_required` → 非LP依存ID → 従来通りerror
- 自動補完時のcomment: `"LPデータ取得制限により評価不能（AI出力に欠落していたため自動補完）"`

#### 1B. プロンプト強化（防御策）
**ファイル**: [review_prompt_builder.py](tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py)

- `_CONCISE_OUTPUT_RULES` に rubric_scores の完全性ルールを追加
- `build_ad_lp_review_prompt` に「全8項目の列挙と欠落禁止」の強調ブロックを追加

#### 1C. フロントエンド リトライ条件の明示化
**ファイル**: [src/api/marketLens.js](src/api/marketLens.js)

- `isReviewRetryableError` に `"output validation failed"` を明示追加（L380）

---

## エラー2: Discovery Hub — タイムアウト

### 根本原因
フロントエンド180秒タイムアウトに到達。Render無料枠のコールドスタート、またはClaude APIの一時的な遅延が疑われる。**タイムアウト値は増やさない**（ユーザーフィードバック制約）。

### 修正内容

#### 2A. 自動再送信前にバックエンド再ウォーム
**ファイル**: [src/pages/Discovery.jsx](src/pages/Discovery.jsx)

- 自動再送信ブロック内で `warmMarketLensBackend()` を呼び出し（最大5秒待機）
- コールドスタート後に即リトライしてまた失敗するのを防止

#### 2B. 自動再送信条件の拡張
**ファイル**: [src/pages/Discovery.jsx](src/pages/Discovery.jsx)

- 現在: `isAnalyzeTimeoutFailure` のみ
- 修正後: タイムアウト + サーバー無応答 + ステージ停滞 も含む
- `DISCOVERY_AUTO_RESUBMIT_MAX = 1` はそのまま（無限ループ防止）

#### 2C. ポーリング失敗時のバックエンド準備状態リセット
**ファイル**: [src/api/marketLens.js](src/api/marketLens.js)

- `getDiscoveryJob` のcatchで `_directBackendReady = false` にリセット
- ネットワークエラー/503時の再接続を改善

---

## 変更ファイル一覧

| ファイル | 修正内容 |
|---------|---------|
| [review_output_validator.py](tmp_market_lens_ai_repo/web/app/services/review/review_output_validator.py) | LP依存rubric IDの自動補完ロジック |
| [review_prompt_builder.py](tmp_market_lens_ai_repo/web/app/services/review/review_prompt_builder.py) | プロンプトにrubric完全性ルール追加 |
| [src/api/marketLens.js](src/api/marketLens.js) | リトライ条件追加 + ポーリング失敗時リセット |
| [src/pages/Discovery.jsx](src/pages/Discovery.jsx) | 再ウォーム + 再送信条件拡張 |

## 実装順序

1. **Phase 1**: バックエンド修正（1A + 1B）→ テスト実行
2. **Phase 2**: フロントエンド修正（1C + 2A + 2B + 2C）→ ビルド確認
3. **Phase 3**: 手動テスト（Creative Review + Discovery Hub）

## 検証方法

1. `pytest tests/test_remediation_regression.py` — 既存テスト通過確認
2. `npm run build` — フロントエンドビルド成功確認
3. ブラウザでCreative Review（LP URL付き）→ エラー解消確認
4. ブラウザでDiscovery Hub → タイムアウト時の自動リトライ動作確認
