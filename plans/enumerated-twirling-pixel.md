# パスワード1つでログイン — 案件別アクセス制御

## Context

現状のログイン画面はメール+パスワードの管理者向けのみ。
お客さんがパスワード1つで自分の案件データだけ見れるようにしたい。

**ゴール:** ログイン画面にパスワード欄1つ。入力されたパスワードに応じてアクセス範囲が決まる。

| パスワード | アクセス範囲 |
|-----------|-------------|
| 案件パスワード（例: サウルスジャパン用） | その案件のBQデータだけ |
| 管理者パスワード（APP_PASSWORD） | 全案件 + 管理機能 |

## 仕組み

1. ユーザーがパスワードを入力
2. フロントエンドが以下を**並列で**試行:
   - `POST /api/ads/auth/login` → 管理者パスワード照合
   - `POST /api/ads/cases/login` × 各案件 → 案件パスワード照合
3. 最初に成功したレスポンスでログイン確定
   - 管理者一致 → 全権限（現行と同じ）
   - 案件一致 → その案件のみ閲覧可能

## 実装

### Step 1: Login.jsx を改修

**ファイル:** `src/pages/Login.jsx`

- メールアドレス欄を**削除**
- パスワード欄のみのシンプルなフォームに変更
- submit時の処理:

```js
async function handleSubmit(password) {
  // 管理者 + 全案件を並列で試行
  const adminPromise = loginAds(password)         // POST /api/ads/auth/login
  const casePromises = activeCases.map(c =>
    loginCase(c.case_id, password).then(r => ({ ...r, _matched: true }))
      .catch(() => null)
  )
  
  const results = await Promise.allSettled([adminPromise, ...casePromises])
  
  // 管理者パスワード一致
  if (results[0].status === 'fulfilled') → admin login
  
  // 案件パスワード一致
  const matched = caseResults.find(r => r?._matched)
  if (matched) → case login (その案件に固定)
  
  // どれも不一致
  → エラー表示
}
```

- 案件一覧は `GET /api/ads/cases`（認証不要エンドポイント）で事前取得

### Step 2: AuthContext に案件ログインモードを追加

**ファイル:** `src/contexts/AuthContext.jsx`

- `loginWithCase(caseResult)` を追加
  - tokenをセット（案件ログインが返すopaque token）
  - userを `{ role: 'case_user', case_id, name }` で保存
  - `isAdsAuthenticated = true`

### Step 3: 案件ユーザーの表示制限

**ファイル:** `src/components/Layout.jsx`, `src/contexts/RbacContext.jsx`

案件ユーザー（`role === 'case_user'`）の場合:
- CaseSelector: 非表示（案件固定）
- サイドバー: 「広告考察」のみ表示（ダッシュボード、競合LP、プロジェクト管理、設定は非表示）
- ヘッダー: 案件名を表示

### Step 4: AuthGuard / ルーティング調整

**ファイル:** `src/App.jsx`

- `AuthGuard`: `case_user` も認証済みとして通す
- 案件ユーザーは `/ads/wizard` にデフォルトリダイレクト
- `/projects`, `/settings`, `/compare` 等にはアクセス不可

### Step 5: SetupGuard 調整

**ファイル:** `src/App.jsx`

- 案件ユーザーは `isCaseAuthenticated = true` を自動セット（案件ログインで既に認証済み）
- `AdsSetupContext` で案件ログインユーザーの `currentCase` を自動設定

## 変更ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `src/pages/Login.jsx` | パスワード1欄のみのログインフォームに改修 |
| `src/contexts/AuthContext.jsx` | `loginWithCase()` 追加 |
| `src/contexts/RbacContext.jsx` | `case_user` ロール対応 |
| `src/components/Layout.jsx` | 案件ユーザー向けメニュー制限 |
| `src/App.jsx` | AuthGuard / ルーティング調整 |
| `src/contexts/AdsSetupContext.jsx` | 案件ログイン時の自動ケース設定 |

## 手動作業

1. プロジェクト管理画面でサウルスジャパンの✏️ → パスワードを設定 → 保存
2. そのパスワードをお客さんに共有
3. （他の案件も同様にパスワード設定可能）

## バグ修正（デプロイ後に発見）

### Bug 1: 案件一覧の取得結果パース失敗
- **ファイル:** `src/pages/Login.jsx:34`
- **原因:** `getCasesPublic()` は `{ok, cases: [...]}` を返すが、`Array.isArray(cases)` でチェックしており常にfalse
- **修正:** `.then((data) => setActiveCases(data.cases || (Array.isArray(data) ? data : [])))`

### Bug 2: 管理者ログインのAPI呼び出しが間違い
- **ファイル:** `src/pages/Login.jsx:51`
- **原因:** `loginWithEmail('admin', password)` → 存在しないメール 'admin' でログイン試行
- **修正:** `loginAds(password)` に変更（`POST /api/ads/auth/login` でAPP_PASSWORD照合）
- AuthContext の `loginAds` 成功時に user を `{role: 'admin', display_name: 'オペレーター'}` でセットする処理も必要

## 検証方法

1. 管理者パスワードでログイン → 全案件 + 管理画面が見れること
2. サウルスジャパンのパスワードでログイン → サウルスジャパンのBQデータだけ見れること
3. サウルスジャパンユーザーがプロジェクト管理や他案件にアクセスできないこと
4. 間違ったパスワード → エラー表示
