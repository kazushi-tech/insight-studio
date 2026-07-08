# Plan: 案件ログイン改善 — 白画面修正・二重認証排除・サイドバー復活・ログアウト追加

## Context

サウルスジャパン案件パスワード(`Saurus2026`)でログインすると:
1. **白画面バグ**: ログイン成功後に一瞬真っ白になり、リロードで表示される
2. **二重認証の壁**: 案件パスワードで入っても「考察スタジオへのログインが必要です」警告が出て操作不可
3. **サイドバーに広告考察しか出ない**: 競合分析(Compare)、競合発見(Discovery)、バナーレビュー(CreativeReview)が非表示
4. **ログアウト手段がない**: ヘッダーにログアウトボタンがない

**根本原因(白画面+二重認証)**: バックエンド `api_cases_login` は案件パスワードがAPP_PASSWORDと一致する場合のみJWTトークンを発行。案件固有パスワードではトークンなし → `isAdsAuthenticated=false` → 機能ロック。

**根本原因(サイドバー)**: App.jsxの`NonCaseGuard`とLayout.jsxのcase_userフィルターが競合分析系ページをブロック。ローカルでは修正済みだが未デプロイ。

---

## 修正計画

### 1. バックエンド: 案件ログインでもJWTトークンを発行

**ファイル:** `tmp_ads_insights_repo/web/app/backend_api.py:2631-2633`

案件パスワード認証が成功したら、APP_PASSWORDとの一致に関係なくトークンを発行する。

```python
# Before (line 2631-2633)
if secrets.compare_digest(password, _AUTH_PASSWORD):
    response_data["token"] = _generate_auth_token()

# After — 案件認証成功時は常にトークン発行
response_data["token"] = _generate_auth_token()
```

→ コミット & push → Render自動デプロイ

### 2. フロントエンド: 案件ログイン後 `/ads/wizard` へ直接遷移

**ファイル:** `src/pages/Login.jsx:39`

```jsx
// Before
if (user) return <Navigate to="/" replace />

// After — case_user は直接 wizard へ
if (user) {
  return <Navigate to={user.role === 'case_user' ? '/ads/wizard' : '/'} replace />
}
```

### 3. フロントエンド: サイドバー・ルーティングで競合分析系を復活 (ローカル修正済み)

既にローカルで修正済みの内容:

**`src/App.jsx`:**
- `NonCaseGuard` コンポーネント削除済み
- compare, discovery, creative-review, settings の `NonCaseGuard` ラップ解除済み
- AuthGuard の `isCaseUser` リダイレクト削除済み

**`src/components/Layout.jsx:463-467`:**
- case_user を「広告考察」のみに制限するフィルター削除済み

→ これらをコミット & Vercelデプロイ

### 4. フロントエンド: ログアウトボタン追加

**ファイル:** `src/components/Layout.jsx:594-602`（ヘッダー右側のプロフィール部分）

アバターの横にログアウトボタンを追加:

```jsx
<button
  onClick={logoutAds}
  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
  title="ログアウト"
>
  <span className="material-symbols-outlined">logout</span>
</button>
```

`logoutAds` は `useAuth()` から取得（Layout.jsxで既にインポート済み）。

---

## 修正ファイル一覧

| ファイル | 変更内容 | 状態 |
|----------|----------|------|
| `tmp_ads_insights_repo/web/app/backend_api.py:2631` | 案件ログインで常にJWT発行 | **未修正** |
| `src/pages/Login.jsx:39` | case_user → `/ads/wizard` へ直接遷移 | **未修正** |
| `src/App.jsx` | NonCaseGuard削除、ルート制限解除 | ローカル修正済み |
| `src/components/Layout.jsx:463` | case_userサイドバーフィルター削除 | ローカル修正済み |
| `src/components/Layout.jsx:594付近` | ログアウトボタン追加 | **未修正** |

## デプロイ順序

1. **バックエンド** (ads-insights): backend_api.py 修正 → commit → push → Render自動デプロイ
2. **フロントエンド** (insight-studio): Login.jsx + Layout.jsx修正 → commit → push → Vercel自動デプロイ
3. 両方デプロイ完了後に検証

## 検証手順

1. ゲストモードで `Saurus2026` 入力 → 白画面なく `/ads/wizard` に直接遷移するか
2. 「考察スタジオへのログインが必要です」警告が消えているか
3. サイドバーにダッシュボード、競合LP分析(Compare/Discovery/CreativeReview)、設定が表示されるか
4. 各ページに実際にアクセスできるか
5. ヘッダーのログアウトボタンで `/login` に戻るか
6. `PemAds2026!` で管理者ログイン → 全機能アクセス確認
