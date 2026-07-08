# Handoff: サウルスジャパン案件追加 & パスワードログイン改修

**日時:** 2026-04-07 14:00  
**ブランチ:** master  
**最新コミット:** `5e7675f feat: single-password login with per-case access control`

---

## 背景

サウルスジャパン（GA4クライアント）をInsight Studioに追加し、お客さんがパスワード1つで自分の案件データだけ見られるようにする作業。

---

## 完了済み

### 1. バックエンド（ads-insights リポ）
| 項目 | コミット | 内容 |
|------|---------|------|
| 案件追加 | `900328a` | `cases/cases.json` に `saurus_japan` を追加。dataset: `saurusjapan-analytics.analytics_287510881` |
| JWT検証 | `1b91895` | `_validate_token()` にHS256 JWT検証追加。opaque tokenフォールバック付き |
| プッシュ済み | — | main → Render自動デプロイ済み |

### 2. GCP IAM
- `saurusjapan-analytics` プロジェクトに `bq-reader@analyzedataplatform.iam.gserviceaccount.com` → BigQueryデータ閲覧者 + ジョブユーザー ✅

### 3. Render環境変数
- `JWT_SECRET` を追加済み（Vercelと同じ値: `.env` の5行目参照）✅

### 4. フロントエンド（insight-studio リポ）
| コミット | 内容 |
|---------|------|
| `26f9818` | admin は案件認証モーダルをスキップ（Layout.jsx の handleCaseSelect 改修） |
| `5e7675f` | パスワード1欄ログインに改修（Login.jsx, AuthContext, RbacContext, Layout, App, AdsSetupContext） |

### 5. 案件パスワード設定
- プロジェクト管理画面からサウルスジャパンのパスワードを `Saurus2026` に設定済み ✅

### 6. 動作確認済み
- ゲストモードで `Saurus2026` 入力 → サウルスジャパン案件のセットアップ画面に到達 ✅
- サイドバーは「広告考察」のみ表示（案件ユーザー制限）✅

---

## 未完了・要修正

### 🔴 Bug: 管理者パスワードでログインできない

**ファイル:** `src/pages/Login.jsx:51`

```js
// 現状（壊れている）
const adminPromise = loginWithEmail('admin', password)
```

`loginWithEmail` は `POST /api/ads/auth/login-email` を呼ぶが、メールアドレスが `'admin'` にハードコードされており、`AUTH_USERS` のどのユーザーとも一致しない。

**修正方針:**
- `loginWithEmail('admin', password)` → `loginAds(password)` に変更
- `loginAds` は `POST /api/ads/auth/login`（APP_PASSWORD照合）を呼ぶ
- 成功時に `user` を `{ role: 'admin', display_name: 'オペレーター' }` でセットする処理を `AuthContext.jsx` に追加
- `loginAds` を `Login.jsx` の import に追加（AuthContext から取得）

**関連ファイル:**
- `src/pages/Login.jsx:28` — `useAuth()` から `loginAds` を取得
- `src/pages/Login.jsx:51` — `loginWithEmail` → `loginAds` に差し替え
- `src/contexts/AuthContext.jsx` — `loginAds` 成功時に admin user をセット

### 🔴 Bug: getCasesPublic のレスポンスパースが壊れている

**ファイル:** `src/pages/Login.jsx:34`

```js
// 現状（壊れている）
getCasesPublic()
  .then((cases) => setActiveCases(Array.isArray(cases) ? cases : []))
```

バックエンドは `{ ok: true, cases: [...] }` を返すが、`Array.isArray(cases)` でオブジェクトをチェックしており常に `false` → `activeCases` が空 → 案件パスワード照合が実行されない。

**修正:**
```js
getCasesPublic()
  .then((data) => {
    const list = data.cases || (Array.isArray(data) ? data : [])
    setActiveCases(list.filter(c => c.is_active !== false))
  })
  .catch(() => setActiveCases([]))
```

### 🟡 案件ユーザーに競合LP分析・ダッシュボード等を復活させる

**現状:** case_user はサイドバーで「広告考察」しか見えない。ダッシュボード、競合LP分析（LP比較分析、競合発見、クリエイティブ診断）、設定が非表示。

**ユーザーの要望:** 競合LP分析などは案件に紐づかない共通機能なので、case_user にも表示すべき。

**修正箇所:**

1. `src/components/Layout.jsx:463-467` — サイドバーフィルター修正
```js
// 現状: case_user は「広告考察」のみ
.filter((item) => {
  if (!isCaseUser) return true
  return item.label === '広告考察'
})

// 修正後: case_user は「プロジェクト管理」だけ非表示（adminOnlyフラグで既に制御済み）
// → この .filter() ブロックを丸ごと削除
```

2. `src/App.jsx:116-118` — NonCaseGuard を削除
```jsx
// 現状
<Route path="compare" element={<NonCaseGuard><Compare /></NonCaseGuard>} />
<Route path="discovery" element={<NonCaseGuard><Discovery /></NonCaseGuard>} />
<Route path="creative-review" element={<NonCaseGuard><CreativeReview /></NonCaseGuard>} />

// 修正後
<Route path="compare" element={<Compare />} />
<Route path="discovery" element={<Discovery />} />
<Route path="creative-review" element={<CreativeReview />} />
```

3. `src/App.jsx:125` — 設定ページも復活
```jsx
// 現状
<Route path="settings" element={<NonCaseGuard><Settings /></NonCaseGuard>} />
// 修正後
<Route path="settings" element={<Settings />} />
```

4. `src/App.jsx:79-81` — case_user の `/` リダイレクトを削除（ダッシュボード表示OK）
```jsx
// 削除
if (isCaseUser && window.location.pathname === '/') {
  return <Navigate to="/ads/wizard" replace />
}
```

5. `src/App.jsx:91-96` — `NonCaseGuard` コンポーネント自体を削除（不要になる）

---

## 現在のパスワード体系

| パスワード | 保存場所 | 用途 |
|-----------|---------|------|
| APP_PASSWORD | Render環境変数 | 管理者ログイン（全機能） |
| 案件パスワード | cases.json の bcrypt hash | 案件ユーザーログイン |
| JWT_SECRET | Render + Vercel 環境変数 | JWT署名・検証（内部） |
| AUTH_USERS | Vercel 環境変数 | メールログイン（**現在は未使用**、パスワードログインに移行済み） |

**管理者の実際のパスワード:** Renderダッシュボード → ads-insights → Environment → `APP_PASSWORD` の値

---

## 認証フロー図

```
ログイン画面（パスワード1欄のみ）
    │
    ├─→ POST /api/ads/auth/login (APP_PASSWORD照合) ─→ 管理者
    │
    ├─→ POST /api/ads/cases/login (saurus_japan + pw) ─→ サウルスジャパン案件ユーザー
    ├─→ POST /api/ads/cases/login (petabit + pw)      ─→ ペタビット案件ユーザー
    └─→ POST /api/ads/cases/login (hibarai + pw)      ─→ hibarai案件ユーザー
    
    ※全リクエストは並列実行、最初に成功したものでログイン確定
```

---

## 関連ファイル一覧

### フロントエンド（insight-studio）
| ファイル | 役割 |
|----------|------|
| `src/pages/Login.jsx` | ログイン画面（パスワード1欄） |
| `src/contexts/AuthContext.jsx` | 認証状態管理（loginAds, loginWithEmail, loginWithCase） |
| `src/contexts/RbacContext.jsx` | ロール判定（admin, client, case_user） |
| `src/contexts/AdsSetupContext.jsx` | 案件選択・セットアップ状態管理 |
| `src/components/Layout.jsx` | サイドバー・ヘッダー（ロール別表示制御） |
| `src/components/CaseSelector.jsx` | 案件切替ドロップダウン |
| `src/components/CaseAuthModal.jsx` | 案件パスワードモーダル（admin はスキップ） |
| `src/App.jsx` | ルーティング・ガード（AuthGuard, AdminGuard, NonCaseGuard） |
| `src/api/adsInsights.js` | API呼び出し（getCasesPublic, loginCase, login 等） |
| `api/ads/auth/login-email.js` | Vercel serverless: メールログインJWT署名 |

### バックエンド（ads-insights リポ, tmp_ads_insights_repo/）
| ファイル | 役割 |
|----------|------|
| `cases/cases.json` | 案件定義（ID, 名前, dataset_id, password_hash） |
| `web/app/backend_api.py:1258-1300` | JWT検証 + opaque token検証 |
| `web/app/backend_api.py:2582-2639` | `POST /api/cases/login` 案件認証 |
| `.env.example` | 環境変数テンプレート |

---

## 次のセッションでやること（優先順）

1. 🔴 **Bug修正2件**（Login.jsx の admin ログイン + cases パース）
2. 🟡 **サイドバー復活**（競合LP分析・ダッシュボード・設定を case_user に表示）
3. 🟡 **管理者ログイン動作確認**（APP_PASSWORD でログイン → 全機能アクセス確認）
4. ⚪ **クライアントユーザー作成**（後日：サウルスジャパン担当者のパスワード共有）
