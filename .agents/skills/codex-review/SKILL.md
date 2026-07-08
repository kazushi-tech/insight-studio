---
name: codex-review
description: 重要マイルストーン向けの厳格レビューskill。Plan/Diff/Runtime/Releaseの4ゲートで品質を判定し、Critical/Majorが0になるまで修正ループを強制する。「codex-review」「厳格レビュー」「品質ゲート」「最終レビュー」「コミット前レビュー」でトリガー。
---

# Codex Review

`universal-review` より厳格な、マイルストーン向けレビューskill。

## 自動発火条件

以下のいずれかに該当したら、ユーザーの明示指示がなくても実行する。

- `plans/*.md` を新規作成または大幅更新したとき
- 主要実装後（目安: 5ファイル以上、public API変更、設定/インフラ変更）
- `commit / push / PR / deploy` の直前

## レビューモード

### 1. Plan Gate

対象: `plans/*.md`、仕様メモ

確認事項:
- 目的/非目標/受け入れ基準が明確か
- 依存関係と実施順が矛盾していないか
- 検証手順が実行可能か
- ロールバック条件が定義されているか

### 2. Diff Gate

対象: `git diff`、変更ファイル全体

確認事項:
- 要件外変更が混入していないか
- 回帰リスク（null/型/非同期/境界値）がないか
- セキュリティ・秘密情報漏えいがないか
- デバッグコードや暫定コードが残っていないか

### 3. Runtime Gate

対象: build/test/lint の実行結果

確認事項:
- `npm run build` が成功するか
- 利用可能なら `npm run lint` / テストが成功するか
- 実行不能な場合は理由と残留リスクを明示したか

### 4. Release Gate

対象: リリース前最終確認

確認事項:
- DevToolsまたは同等手段で実機確認したか
- スクリーンショットやログ等の証跡があるか
- 重大指摘がゼロの状態であるか

## 実行フロー

1. 対象スコープを確定（ファイル指定がなければ `git diff` ベース）。
2. 必要なゲートを選択してレビューを実施。
3. 以下フォーマットで結果を出力。
4. `Critical/Major > 0` の場合は **BLOCKED** 判定とし、修正案を提示。
5. 修正後に再レビューし、PASSまで繰り返す。

## レポート形式（必須）

```markdown
<!-- codex-review -->
## Review: [scope]

- Date: YYYY-MM-DD HH:mm
- Mode: Plan / Diff / Runtime / Release
- Verdict: PASS / BLOCKED

### Critical
- FIND-001: ...

### Major
- FIND-002: ...

### Minor
- FIND-003: ...

### Required Fixes
1. ...

### Evidence
- Command: ...
- Result: ...
```

## 運用ルール

- `commit/push/deploy` は **PASS判定後のみ** 実行可能。
- レビュー結果は原則 `.reviews/review-YYYY-MM-DD-HHMMSS.md` に保存する。
- `codex-review` が利用不能な環境では `universal-review` を代替に使う。