---
name: ads-deploy
description: Deployment skill for ads-insights project. This skill should be used when users want to deploy changes to production via Vercel, create version tags, or verify deployment status. Triggers on phrases like "デプロイして", "本番環境に反映", "Vercelにプッシュ", "リリース".
---

# Ads Deploy

ads-insightsをVercelにデプロイするためのスキル。

## デプロイワークフロー

### 前提条件

- すべての変更がコミット済み
- テストが通過している（`/ads-test`で確認）
- mainブランチにいる（または機能ブランチからPRを作成）

### Step 1: デプロイ前チェック

```powershell
# 未コミットの変更がないか確認
git status

# テストを実行
python tests/test_v2_5_basic.py
python tests/test_v2_5_display.py
```

詳細は [references/deploy_checklist.md](references/deploy_checklist.md) を参照。

### Step 2: mainブランチにプッシュ

```powershell
git push origin main
```

Vercelは自動的にmainブランチの変更を検出してデプロイを開始する。

### Step 3: デプロイ状況の確認

```powershell
# Vercel CLIがインストールされている場合
vercel ls

# またはVercelダッシュボードで確認
# https://vercel.com/dashboard
```

### Step 4: バージョンタグ（オプション）

重要なリリースにはバージョンタグを付ける:

```powershell
# 例: V2.8のリリース
git tag -a v2.8 -m "V2.8: Media extraction improvements"
git push origin v2.8
```

## バージョン命名規則

| 変更の種類 | バージョン変更 | 例 |
|-----------|---------------|-----|
| バグ修正 | パッチ (x.x.Y) | v2.7.1 |
| 機能追加 | マイナー (x.Y.0) | v2.8 |
| 破壊的変更 | メジャー (Y.0.0) | v3.0 |

## ロールバック

問題が発生した場合:

```powershell
# 直前のコミットに戻す
git revert HEAD
git push origin main

# または特定のコミットに戻す
git revert <commit-hash>
git push origin main
```

Vercelは自動的に新しいコミットをデプロイする。

## 環境変数

本番環境の環境変数はVercelダッシュボードで管理:

1. Project Settings → Environment Variables
2. 必須: `GEMINI_API_KEY`
3. オプション: `DATA_PROVIDER` (本番では通常 `excel`)

**注意**: 環境変数を変更した場合は再デプロイが必要。
