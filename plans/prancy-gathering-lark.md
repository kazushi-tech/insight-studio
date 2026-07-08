# PEM共有アカウント追加

## Context

顧客別データ分離（sleepy-drifting-valley）のコード変更は完了・デプロイ済み。
次のステップとして、PEM社員全員が使える共有adminアカウントを追加する。

## 実装内容

### `.env` の `AUTH_USERS` に新ユーザー追加

- **Email**: pem.advertisement@gmail.com
- **Password**: PemAds2026!（sha256ハッシュを生成して設定）
- **Role**: admin
- **Display name**: PEM広告チーム

既存の kazushi@example.com admin は維持し、2つ目のadminとして追加。

### 対象ファイル

| ファイル | 操作 |
|---------|------|
| `.env` | AUTH_USERS JSONに新ユーザー追加 |
| Vercel Dashboard | 同じく環境変数を更新 |

### 検証

1. `pem.advertisement@gmail.com` / `PemAds2026!` でログイン
2. admin権限で全案件が表示されることを確認
3. 既存の kazushi アカウントも引き続き動作確認
