# Fix: Discovery / Compare 生成エラー — ローカル再現→根本修正

## Context

Discovery と Compare がどちらも長時間待った末にエラーになる。タイムアウト値を増やすアプローチは**過去に何度も失敗しており絶対禁止**。実際にローカルで動かして原因を特定し、処理を軽くする方向で修正する。

## 調査で判明した問題点

### 1. プロンプト肥大化（最大の疑い）
- `analyzer.py` の `build_deep_comparison_prompt()` が直近3コミットで大幅拡張
  - be03a42: 8セクション+8注意書き追加
  - 4c936f3: LP分類・価格戦略・モバイル最適化の評価軸追加、出力テーブル5列→6列
  - dc58823: ブランド名抽出ロジック追加
- `max_output_tokens` が 3072 → 5120 に増加（commit 92c4126、メッセージは "reduce" だが実際は増加）
- **結果:** 入力・出力トークンが膨らみ、LLM応答が遅くなった

### 2. 追加LLMコール（candidate_ranker.py）
- `validate_candidates_with_llm()` が D-1 機能として追加（commit 4c936f3）
- Discovery パイプラインに3つ目のLLM呼び出しが増えた（classify → validate → analyze）
- +10秒のレイテンシ追加

### 3. 検索数の増加
- `search_client.search()` の `num` が 7 → 12 に増加
- 2つ目のクエリも追加（D-2機能）→ 検索時間が約2倍に
- `MAX_COMPETITORS` が 2 → 4 に増加 → fetch + analyze の対象が倍増

### 4. タイムアウト構造不整合（リバート後）
- パイプライン: analyze=120s, search=45s
- ルート: _analyze=150s (or 180s), overall=150s
- 二重定義で不整合あり（ただしこれはタイムアウトを増やすのではなく処理を速くして対応）

## 修正方針（タイムアウト値は変更しない）

### Step 1: ローカルで再現テスト
1. `market-lens-ai` バックエンドをローカル起動（port 8002）
2. `insight-studio` フロントエンドをローカル起動（port 3002）
3. Chrome DevToolsでDiscoveryとCompareを実行
4. 各ステージの実際の所要時間とエラーを記録

### Step 2: プロンプト最適化（analyzer.py）
- `build_deep_comparison_prompt()` の肥大化部分を精査
- 重複・冗長なセクションを削減
- `max_output_tokens` を 5120 → 3072〜4096 に戻す（出力品質を維持できる範囲で）
- 目標: analyze ステージを60秒以内に収める

### Step 3: パイプライン軽量化（discovery_pipeline.py）
- `validate_candidates_with_llm()` の必要性を検証 → 不要なら削除、必要ならタイムアウト短縮
- 検索 `num` を 12 → 7 に戻す（or適切な値に）
- 2つ目の検索クエリの必要性を検証
- `MAX_COMPETITORS` を 4 → 2 に戻す（分析品質が十分なら）

### Step 4: Compare（scan）エンドポイント確認
- `/api/scan` が同じ `analyze()` を使うため、プロンプト最適化で同時に改善されるはず
- 別途問題があればローカルテストで発見

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `market-lens-ai/web/app/analyzer.py` | プロンプト縮小、max_output_tokens削減 |
| `market-lens-ai/.../discovery_pipeline.py` | 検索数・競合数・LLMバリデーション見直し |
| `market-lens-ai/.../candidate_ranker.py` | LLMバリデーション削除or短縮（テスト結果次第） |

## 検証方法

1. ローカルバックエンド起動 → Discovery / Compare を実行
2. 各ステージの実測時間を記録（before/after）
3. 全体60秒以内で完了することを確認
4. 本番デプロイ後、Render上でも同様に確認
