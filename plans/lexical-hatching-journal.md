# Vercel Serverless認証エンドポイント実装プラン

## Context

ログイン必須化（commit `1f49cc1`）により全ルートでAuthGuardが有効になったが、
バックエンド（ads-insights）に `/auth/login-email` エンドポイントが未実装のため、
ログインが不可能な状態。Vercel Serverless Functionで認証エンドポイントを追加し、
管理者・社内メンバーがログインできるようにする。

## 方針

Vercelサーバーレス関数 + 環境変数でユーザー管理。フロントエンド変更なし。

## 実装ステップ

### Step 1: 依存追加
```bash
npm install jsonwebtoken
```

### Step 2: サーバーレス関数作成

**`api/ads/auth/login-email.js`** （プロジェクトルート直下）

- Vercel Functionsはrewriteより優先されるため、フロントの `POST /api/ads/auth/login-email` をインターセプト
- フロントエンド側の変更不要

処理フロー:
1. POSTリクエストから `{ email, password }` を取得
2. 環境変数 `AUTH_USERS` (JSON) からユーザーリストを読み込み
3. emailで検索 → パスワードをSHA-256ハッシュ比較
4. 一致すれば `jsonwebtoken` でJWT生成（秘密鍵: `JWT_SECRET` 環境変数）
5. レスポンス: `{ token, user: { user_id, email, role, display_name } }`

### Step 3: Vercel環境変数を設定

| 変数名 | 値 |
|--------|-----|
| `JWT_SECRET` | ランダム文字列（64文字） |
| `AUTH_USERS` | JSON配列（下記フォーマット） |

`AUTH_USERS` フォーマット:
```json
[
  {
    "user_id": "admin1",
    "email": "kazushi@example.com",
    "password_hash": "<sha256 hash>",
    "role": "admin",
    "display_name": "Kazushi"
  }
]
```

パスワードハッシュは `echo -n "パスワード" | sha256sum` で生成。

### Step 4: ローカル確認用 `.env` 更新

`.env` に `JWT_SECRET` と `AUTH_USERS` を追加（gitignore済み前提）。

## 対象ファイル

| ファイル | 操作 |
|---------|------|
| `api/ads/auth/login-email.js` | **新規作成** — Vercel serverless function |
| `package.json` | **変更** — jsonwebtoken追加 |
| `.env` | **変更** — JWT_SECRET, AUTH_USERS追加 |
| Vercel Dashboard | 環境変数設定 |

## フロント変更

なし。既存の `src/api/adsInsights.js` が `POST /api/ads/auth/login-email` を呼ぶ構成がそのまま使える。

## 検証手順

1. `vercel dev` でローカル起動
2. ログイン画面でemail + password入力 → トークン取得成功を確認
3. ログイン後、ダッシュボードにリダイレクトされることを確認
4. localStorageに `is_user` と `is_ads_token` が保存されることをDevToolsで確認
5. Vercelにデプロイ後、本番URLで同様に確認
