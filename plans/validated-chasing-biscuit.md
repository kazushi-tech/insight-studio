# プロジェクト管理 統合リファクタリング計画

## Context

現在、案件管理(`/cases`)とプロジェクト管理(`/projects`)が分離しており、前者はAPI接続済みだがUIが素朴、後者は美しいUIだがモックデータ。3つの実案件（テスト案件・ベタビット・hibarai）をジューサーのようにスムーズに設定・管理できる統合画面にする。

## 方針: 1ページに統合

- `/projects` をメインの管理画面にする（美しいUIを活かす）
- `/cases` は `/projects` へリダイレクト
- バックエンドのエンティティは「case」のまま、フロントでは「プロジェクト」と呼ぶ
- クライアントにも見せる（RBAC対応で権限別表示）

## Phase 1: データ接続（モック → 実API）

### `src/components/ProjectTable.jsx`
- `MOCK_PROJECTS` を削除
- props: `projects`, `loading`, `bqStatuses`, `onEdit`, `onShare`, `onBqTest`
- フィールドマッピング:
  | Backend | 表示列 |
  |---------|--------|
  | `name` | プロジェクト名 |
  | `case_id` | ID |
  | `dataset_id` | BQ接続チップ |
  | `status` | ステータス |
  | `description` | サブテキスト |
- `client` 列は `name` で代用（バックエンドにclientフィールドなし）
- Stats cards: 実データから算出

### `src/pages/ProjectManagement.jsx`
- `getCases`, `getCaseBqStatus` をインポート
- `useAuth` で認証チェック
- `useEffect` でケース一覧をfetch
- BQステータスを `dataset_id` ありのケースに対して自動テスト
- `ProjectTable` にデータをpropsで渡す

## Phase 2: ウィザード型モーダル

### `src/components/ProjectFormModal.jsx` → 3ステップウィザード化

**Step 1: 基本情報**
- プロジェクト名 (`name`)
- 案件ID (`case_id`) — 自動生成候補付き
- 説明 (`description`)

**Step 2: BigQuery接続**
- Dataset ID入力
- ライブ接続テストボタン（`getCaseBqStatus` をインライン呼び出し）
- 成功: 緑チェック + テーブル数表示
- 失敗: エラーメッセージ
- スキップ可能（後で設定可）

**Step 3: セキュリティ & 確認**
- パスワード設定
- 入力内容のサマリー表示
- 送信 → `createCase` / `updateCase` API呼び出し

## Phase 3: BQステータス強化

### ProjectTable内のBQ表示
- **管理者向け**: 緑ドット + "Connected (12テーブル)" / 赤ドット + エラー / 再テストボタン
- **クライアント向け**: 緑ドット + "接続済み" / 黄ドット + "設定中"
- ページ読み込み時に自動テスト

## Phase 4: メンバー管理 & ルート整理

### `src/components/InviteModal.jsx`
- `MOCK_MEMBERS` 削除
- `getProjectMembers(caseId)` でメンバー取得
- `inviteMember` / `removeMember` API接続

### `src/App.jsx`
- `/cases` → `<Navigate to="/projects" replace />`

### `src/components/Layout.jsx`
- サイドバーの「案件管理」を削除
- 「プロジェクト管理」の `adminOnly` を緩和（クライアントは閲覧のみ）

## 対象ファイル

| ファイル | 変更規模 |
|---------|---------|
| `src/components/ProjectTable.jsx` | 大（モック→props化） |
| `src/components/ProjectFormModal.jsx` | 大（ウィザード化+API接続） |
| `src/pages/ProjectManagement.jsx` | 中（データfetch追加） |
| `src/components/InviteModal.jsx` | 中（API接続） |
| `src/App.jsx` | 小（リダイレクト追加） |
| `src/components/Layout.jsx` | 小（ナビ整理） |

## 注意事項

- `CaseSelector` は変更なし（同じ `/cases` APIを使い続ける）
- deleteCase APIは未実装 → 削除ボタンは非表示 or disabled
- `dataset_id` のないケースはBQチップを「未設定」表示
- バックエンドに `client` フィールドがないため、Stats cardsの「クライアント数」は「プロジェクト数」に変更

## 検証方法

1. `npm run dev` でローカル起動
2. `/projects` にアクセス → 3つの実案件がテーブルに表示されること
3. BQ接続ステータスが自動テストされること
4. 「新規追加」→ ウィザードモーダルが3ステップで動作すること
5. 編集ボタンでケース更新が正常に動くこと
6. `/cases` にアクセス → `/projects` にリダイレクトされること
7. `CaseSelector`（ヘッダー）が引き続き正常動作すること
