# 顧客別データ分離（Project Isolation for Clients）

## Context

ログイン認証（commit `9592b59`）は動作確認済み。しかし現状、ログイン後は
admin も client も **全案件が見えてしまう** 状態。顧客（client ロール）には
割り当てられた案件だけを表示する必要がある。

**幸い、既存の RBAC インフラが既にこのユースケース用に設計されている。**
`RbacContext.canAccessProject()` が `user?.projectIds` をチェックしているが、
ログインエンドポイントが `projectIds` を返していないためデータが流れていない。

## 方針

**コード変更: 1行（login-email.js）+ 環境変数更新のみ**

既存の RBAC フィルタリングチェーンを活かし、データ接続だけ追加する。

## 実装ステップ

### Step 1: login-email.js — projectIds を返す（1行追加）

**`api/ads/auth/login-email.js`** のレスポンスに `projectIds` を追加。

```diff
  return res.status(200).json({
    token,
    user: {
      user_id: matched.user_id,
      email: matched.email,
      role: matched.role,
      display_name: matched.display_name,
+     projectIds: matched.project_ids || [],
    },
  })
```

### Step 2: AUTH_USERS 環境変数 — client ユーザーに project_ids を追加

Vercel Dashboard + `.env` で、client ユーザーに `project_ids` 配列を設定。

```json
[
  {
    "user_id": "admin1",
    "email": "kazushi@example.com",
    "password_hash": "ac9689e2...",
    "role": "admin",
    "display_name": "Kazushi"
  },
  {
    "user_id": "client1",
    "email": "client@example.com",
    "password_hash": "<sha256>",
    "role": "client",
    "display_name": "クライアントA",
    "project_ids": ["petabit"]
  }
]
```

ルール:
- **admin**: `project_ids` 不要（全案件アクセス可）
- **client**: `project_ids` 必須。空配列 `[]` = 案件なし（安全なデフォルト）
- ID は `getCases()` が返す `case_id` と一致させる

### Step 3: 変更不要の確認

| ファイル | 理由 |
|---------|------|
| `src/contexts/AuthContext.jsx` | `data.user` をそのまま `setUser()` → `projectIds` 自動伝播 |
| `src/contexts/RbacContext.jsx` | `canAccessProject()` が既に `user?.projectIds?.includes()` をチェック |
| `src/components/CaseSelector.jsx` | 既に `isClient ? cases.filter(canAccessProject) : cases` でフィルタ |
| `src/App.jsx` | `AdminGuard` が `/projects` を admin 限定にしている |
| `src/components/Layout.jsx` | サイドバーが `adminOnly` で nav をフィルタ済み |

## 既存の RBAC フィルタリングチェーン

```
login-email.js  →  AuthContext.user  →  RbacContext.canAccessProject()
                                              ↓
                                    CaseSelector フィルタ
                                    Layout ナビフィルタ
                                    AdminGuard ルート保護
```

projectIds が user に入れば、全て自動で動く。

## エッジケース

| ケース | 動作 |
|--------|------|
| client + `project_ids: []` | 全案件非表示、空メッセージ表示 |
| client + 未設定 `project_ids` | `[] || []` → 同上（安全） |
| admin + `project_ids` なし | `isAdmin` で全案件表示（変更なし） |
| env 更新後の古い localStorage | 再ログインで更新（JWT 7日期限） |

## 対象ファイル

| ファイル | 操作 |
|---------|------|
| `api/ads/auth/login-email.js` | **変更** — 1行追加 |
| `.env` / Vercel 環境変数 | **変更** — client ユーザー追加 |

## 検証手順

1. `.env` の `AUTH_USERS` に client ユーザーを追加（`project_ids: ["petabit"]`）
2. admin でログイン → 全案件が CaseSelector に表示されることを確認
3. client でログイン → `project_ids` に含まれる案件のみ表示を確認
4. client + `project_ids: []` → 案件が表示されないことを確認
5. DevTools → localStorage `is_user` に `projectIds` が含まれることを確認
6. Vercel にデプロイ → 本番で同様に確認

## 将来の強化（今回はスコープ外）

- サーバーサイドフィルタリング（Vercel proxy function で getCases をラップ）
- `/api/auth/me` エンドポイント（localStorage 更新用）
- ダッシュボード内の案件別データ表示のフィルタリング
