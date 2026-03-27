# market-lens-orchestrator

## 目的

Market Lens AI リポジトリ全体の実行フェーズを管理し、既存実装を壊さずに段階的改善を進めるためのオーケストレーション skill。

## いつ使うか

- 新しいフェーズに着手するとき
- 複数チームの変更を統合するとき
- フェーズ完了報告を書くとき

## ルール

1. 変更前に `.agent/PLANS.md` と `plans/market-lens-claude-master-plan.md` を読む
2. 現行フェーズを確認してから作業を開始する
3. ファイル ownership（frontend / backend / release）を宣言してから着手する
4. 既存の backend / frontend / tests を読まずに置き換えない
5. フェーズ完了時は以下のフォーマットで報告する:

```
Phase X 完了報告
- 変更したファイル
- 実行したコマンド
- テスト結果
- build結果
- 未完了項目
- 次フェーズの着手内容
```

6. 未実施の項目は必ず「未実施」と明記する

## 参照ファイル

- `plans/market-lens-claude-master-plan.md` — マスタープラン（正）
- `.agent/PLANS.md` — フェーズ進捗
- `CLAUDE.md` — プロジェクト概要とルール
