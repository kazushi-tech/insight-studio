# レビュー結果: jolly-percolating-snowglobe.md

## レビュー対象

`plans/jolly-percolating-snowglobe.md` — Discovery Hub: 5件確実分析フェッチ失敗時の候補差し替え

---

## Critical Issues（致命的問題）

### 1. リポジトリ不一致 — 対象ファイルが存在しない

**問題:** プランが参照する2ファイルがこのリポに存在しない。

| プラン記載ファイル | 存在? |
|---|---|
| `web/app/routers/discovery_routes.py` | ❌ なし |
| `tests/test_discovery_analyze.py` | ❌ なし |

**根拠:** insight-studio はフロントエンドのみのリポ（Vite + React）。バックエンドは `market-lens-ai` リポ（Render デプロイ）に存在する。CLAUDE.md にも「フロントエンドのみの新規リポ。バックエンドは既存サービスをAPIプロキシ経由で呼び出す」と明記。

**影響:** このプランはそのまま実行不可能。正しいリポ（market-lens-ai）で作業する必要がある。

### 2. フロントエンド側の影響分析が欠落

`src/pages/Discovery.jsx` でフェッチ結果をどう表示しているか（「未分析」表示のロジック等）の分析がない。バックエンド修正だけで本当に「未分析」表示が消えるか検証されていない。

---

## Major Issues（重大な問題）

### 3. `ranked` 変数の定義元が不明

Phase 2 で `ranked[MAX_COMPETITORS:]` を使用しているが、`ranked` がどこで定義されるか記載なし。`top_candidates` との関係も不明確。

### 4. Phase 2 の逐次フェッチ — パフォーマンス考慮不足

Phase 2 を逐次（1件ずつ await）にしている。「セマフォ内なので問題なし」と記載があるが、もし3件失敗したら追加3件を直列で待つことになる。バッチ差し替え（残り候補をまとめて並列フェッチ）の方がレイテンシが低い。

### 5. テストケースの記述が曖昧

テスト更新の記載が変更の方向性のみで、具体的なアサーション変更内容やモック設定の変更が書かれていない。

---

## Minor Issues（軽微な問題）

### 6. `MAX_COMPETITORS` 定数の所在未記載
プラン中で `MAX_COMPETITORS` を使っているが、定義箇所（ファイル・行番号）の記載なし。

### 7. 検証手順が手動依存
自動テスト以外の検証（「Discovery Hub で再実行」）がマニュアル。E2Eテストやスモークテストの検討がない。

---

## 修正プラン

このプランを実行可能にするには以下の対応が必要:

### Step 1: 正しいリポで作業する
market-lens-ai リポに移動し、該当ファイルの現在の実装を確認する。

### Step 2: バックエンド修正（market-lens-ai リポ）

**Agent Team 構成（3並列）:**

| Agent | 担当 | 内容 |
|-------|------|------|
| Agent A | バックエンド実装 | `discovery_routes.py` の Phase 1/2 フェッチロジック修正 |
| Agent B | テスト更新 | `test_discovery_analyze.py` のアサーション更新・新テストケース追加 |
| Agent C | フロントエンド影響調査 | insight-studio の `Discovery.jsx` で「未分析」表示ロジックを確認し、必要なら修正 |

### Step 3: フロントエンド確認（insight-studio リポ）
Discovery.jsx のレスポンス処理を確認し、バックエンドの応答形式変更に対応が必要か判断。

### Step 4: 検証
1. market-lens-ai で `pytest` 全テスト通過
2. ローカルでフロントエンド→バックエンド結合テスト
3. Render デプロイ後、Discovery Hub で5件分析を実行し全件成功を確認

---

## 結論

**このプランはリポジトリの選択ミスにより、このまま実行すると失敗する。** market-lens-ai リポで作業を行い、フロントエンド影響も含めた包括的なプランに修正すべき。
