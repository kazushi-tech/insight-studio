---
name: universal-review
description: 計画書・コード変更の軽量レビュースキル。Plan/Diff/Implementation/Configの4モードで品質チェック。「レビューして」「品質チェック」「見直して」「確認して」「コードレビュー」「計画をレビュー」等でトリガー。codex-reviewより軽量な日常レビュー向け。
---

# Universal Review

日常的なコードレビュー・計画レビューを軽量に実施するスキル。
`codex-review` がマイルストーン級の重いレビューに対し、こちらは日常の素早いチェック向け。

## レビューモード

対象を判定し、以下の4モードから自動選択する。

### 1. Plan Review

**対象**: `plans/*.md`
**チェック項目**:
- 目的が明確に記述されているか
- ステップが具体的かつ実行可能か
- リスク評価・影響範囲が記述されているか
- 検証方法が定義されているか

### 2. Diff Review

**対象**: `git diff` の出力
**チェック項目**:
- 意図通りの変更か（不要な変更が混じっていないか）
- セキュリティ上の問題がないか
- 保護ファイル（CLAUDE.mdのリスト参照）を変更していないか
- デバッグコード（console.log等）が残っていないか

### 3. Implementation Review

**対象**: 任意のコードファイル
**チェック項目**:
- DRY原則（重複コードがないか）
- 単一責務原則
- エラーハンドリングの適切さ
- 命名規則の一貫性
- 暗算禁止原則の遵守（計算がコード内で行われているか）

### 4. Config Review

**対象**: `.env`, `package.json`, 設定ファイル等
**チェック項目**:
- 必須項目が揃っているか
- 秘密情報がハードコードされていないか
- バージョン整合性

## レポート形式

```markdown
## Review: [対象ファイル/スコープ]

**モード**: Plan / Diff / Implementation / Config
**総合**: OK / 要修正

### Findings

#### Critical
- (該当なし or 具体的指摘)

#### Major
- (該当なし or 具体的指摘)

#### Minor
- (該当なし or 具体的指摘)

### Summary
(1-2行の総括)
```

## 実行手順

1. 対象を特定する（ユーザー指定 or 自動検出）
   - 引数なし → `git diff` を確認し Diff Review
   - `plans/*.md` が指定 → Plan Review
   - コードファイル指定 → Implementation Review
   - 設定ファイル指定 → Config Review
2. 該当モードのチェック項目を順に確認する
3. レポート形式で結果を出力する
4. Critical/Major がある場合は修正を提案する

## codex-review との使い分け

| 場面 | 推奨 |
|------|------|
| マイルストーン達成時 | `codex-review` |
| 計画書の初回レビュー | `codex-review` |
| 日常のコード変更確認 | `universal-review` |
| コミット前の簡易チェック | `universal-review` |
| 設定ファイル変更確認 | `universal-review` |
