# Multi-BQ 設計スパイク

## 概要

複数 BigQuery プロジェクトへの対応を将来的に実装するための設計メモ。
Phase 4 では実装せず、契約確認と設計整理に留める。

## project_id が必要なエンドポイント候補

| エンドポイント | project_id 必要性 | 備考 |
|---|---|---|
| `/folders` | 要確認 | プロジェクト単位でフォルダが異なる可能性 |
| `/list_periods` | 高い | データソースに依存 |
| `/load` | 高い | 読み込み先 BQ テーブルが異なる |
| `/generate_insights` | 高い | 分析対象データが異なる |
| `/auth/login` | 不要 | ユーザー認証はプロジェクト非依存 |
| `/config` | 要確認 | グローバル設定 vs プロジェクト設定 |
| `/health` | 不要 | システム状態 |
| `/cases` | 要確認 | プロジェクト一覧そのものの可能性 |

## 未確定事項

1. **`getCases()` の契約**: 切替可能なプロジェクト一覧として使えるか
2. **setupState のスコープ**: user-scoped か project-scoped か
3. **localStorage key の設計**: `insight-studio-ads-setup` を project 単位化するか
4. **共通 `request()` への付与方式**: 全エンドポイント一律は不可。ホワイトリスト方式が安全

## 次フェーズへの送り事項

- `ProjectContext` の追加はバックエンド契約確定後
- `request()` の自動 `project_id` 付与はエンドポイントごとの適用範囲が決まってから
- 「新規プロジェクト」ボタンの本来の意味確定も同様
