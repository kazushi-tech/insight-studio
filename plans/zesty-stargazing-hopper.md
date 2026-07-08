# クライアント専用アクセス機能（A案: ロール分岐）

## Context

顧客（クライアント）がInsight Studioにログインして、**自分の案件だけ**を見て分析機能を利用できるようにする。プロジェクト管理以外の全機能を開放。ログインはダーク、管理画面はライトのまま。

## Stitch 2 デザインソース

4つのステートがHTMLエクスポートとして格納済み：

| フォルダ | ステート | 参照ポイント |
|----------|----------|-------------|
| `stitch2/..(21)/code.html` | 初期状態 | カード構造、背景blur、ヘッダー |
| `stitch2/..(22)/code.html` | 入力中 | mailアイコン、lockアイコン、visibilityトグル、arrow_forwardボタン |
| `stitch2/..(23)/code.html` | エラー | error-container/20バナー、赤枠input、errorアイコン |
| `stitch2/..(24)/code.html` | ローディング | loading-spinner CSS、全フォーム disabled、opacity-50 |

### デザインシステム "The Nocturnal Executive"（DESIGN.md）

共通のデザインルール：
- **カラー:** `surface-container-lowest` (#0c0c1f) 背景、`surface-container-low` (#1A1A2E) カード
- **ボタン:** ゴールドグラデーション `from-[#f2c35b] to-[#d4a843]` 135deg、h-12、rounded-lg
- **Input:** `bg-surface-container-highest` (#333348)、h-12、rounded-lg、focus時 `ring-primary` + `bg-surface-bright`
- **No-Lineルール:** ボーダーは使わず背景色の差でカード境界を表現
- **テキスト:** `on-surface` (#e2e0fc)、`on-surface-variant` (#d2c5b1)
- **見出し:** 2.75rem、font-extrabold、tracking-tight、letter-spacing -0.02em

### 実装で採用する要素（(22)をベースに(21)(23)(24)のステートを統合）

- Deep Navy全画面背景 + 左右の装飾blurグラデーション
- 「Insight Studio」ヘッダー（ゴールド、中央寄せ）
- カード: `bg-surface-container-low` rounded-2xl p-10 max-w-[420px]
- カード内ロゴ: 「Insight Studio」+ 「AD OPS & ANALYSIS」
- メールフィールド: mailアイコン左、pl-12
- パスワードフィールド: lockアイコン左、visibilityトグル右
- ログインボタン: ゴールドグラデーション + arrow_forwardアイコン
- エラーステート: `error-container/20` バナー + input赤枠 + errorアイコン
- ローディング: CSS spinnerアニメーション + 全フォームdisabled + opacity-50

### 実装しない要素（スコープ外）

- Google / SSO ログインボタン
- 「新規登録」リンク（管理者招待フローのため不要）
- 「パスワードを忘れた場合」リンク（バックエンド未対応）
- 「ログイン状態を保持する」トグル
- フッター（PRIVACY POLICY等）
- 外部画像URL（テクスチャオーバーレイ等）

## 実装ステップ

### Step 1: ログインページ新規作成

**新規ファイル:** `src/pages/Login.jsx`

(22)のHTMLをベースにReactコンポーネント化。ダーク専用のインラインカラーで実装（アプリのライトモードテーマトークンと分離）。

**状態管理:**
- `email`, `password` — フォーム入力
- `showPassword` — パスワード表示/非表示トグル
- `loading` — 認証中フラグ
- `error` — エラーメッセージ

**API呼び出し:**
- `loginWithEmail(email, password)` from [AuthContext.jsx:64](src/contexts/AuthContext.jsx#L64)
- 成功 → `navigate('/')` でダッシュボードへ
- 失敗 → エラーステート表示

**CSSアニメーション:**
- loading-spinner: Stitch (24)の `@keyframes spin` をインラインstyleまたはindex.cssに追加

### Step 2: ルーティング追加

**ファイル:** [App.jsx](src/App.jsx)

```jsx
import Login from './pages/Login'

// Layout外に /login ルートを追加（ダーク独自レイアウトのため）
<Route path="login" element={<Login />} />

// /projects にAdminGuardを追加
<Route path="projects" element={<AdminGuard><ProjectManagement /></AdminGuard>} />
```

`AdminGuard` コンポーネント:
```jsx
function AdminGuard({ children }) {
  const { isAdmin } = useRbac()
  if (!isAdmin) return <Navigate to="/" replace />
  return children
}
```

### Step 3: ナビゲーションからプロジェクト管理を隠す

**ファイル:** [Layout.jsx:41](src/components/Layout.jsx#L41)

```diff
- { to: '/projects', icon: 'account_tree', label: 'プロジェクト管理' },
+ { to: '/projects', icon: 'account_tree', label: 'プロジェクト管理', adminOnly: true },
```

### Step 4: CaseSelectorでクライアント案件フィルタリング

**ファイル:** [CaseSelector.jsx:20-22](src/components/CaseSelector.jsx#L20-L22)

```jsx
import { useRbac } from '../contexts/RbacContext'
const { isClient, canAccessProject } = useRbac()

// getCases()結果をフィルタ
const accessibleCases = isClient
  ? allCases.filter(c => canAccessProject(c.case_id || c.id))
  : allCases
```

### Step 5: 未認証クライアントのリダイレクト

**ファイル:** [Layout.jsx](src/components/Layout.jsx)

clientロールが必要でログインしていない場合のみ `/login` にリダイレクト。管理者の既存フロー（パスワードなしアクセス）は維持。

## 対象ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `src/pages/Login.jsx` | **新規** — Stitch 2デザイン準拠のダークログインページ |
| [App.jsx](src/App.jsx) | `/login` ルート追加、`AdminGuard` 追加 |
| [Layout.jsx:41](src/components/Layout.jsx#L41) | プロジェクト管理に `adminOnly: true` 追加 |
| [CaseSelector.jsx](src/components/CaseSelector.jsx) | クライアント案件フィルタリング |
| [Layout.jsx](src/components/Layout.jsx) | 未認証時の `/login` リダイレクト |

## セッション持続（スライディング有効期限）

**方針:** ログイン後はトークンを `localStorage` に保存し、アクセスするたびに有効期限を延長する「スライディング期限」方式を採用。定期的に利用していれば事実上ずっとログイン状態が続き、30日以上アクセスしなかった場合のみ再ログインを要求。

### フロントエンド側（このリポ）

**ファイル:** [AuthContext.jsx](src/contexts/AuthContext.jsx)

APIレスポンスに新しいトークンが含まれていたら差し替える「トークンリフレッシュ」の仕組みを追加：

```js
// APIリクエストのレスポンスヘッダーまたはbodyに refreshed_token があれば更新
if (response.refreshed_token) {
  setAdsToken(response.refreshed_token)
  localStorage.setItem('is_ads_token', response.refreshed_token)
}
```

**または**、フロントエンド側でアクセス時に `/api/auth/refresh` を呼ぶインターバルを設ける方式でも可。

### バックエンド側（ads-insightsリポ）

| 対応 | 内容 |
|------|------|
| JWTの有効期限 | 30日に設定 |
| スライディングリフレッシュ | APIリクエスト時にトークンの残り期限が15日未満なら新しいトークンを発行してレスポンスに含める |
| リフレッシュエンドポイント | `POST /api/auth/refresh` — 有効なJWTを送ると新しい30日トークンを返す（任意） |

**動作イメージ:**
```
Day 0:  ログイン → JWT発行（期限: Day 30）
Day 20: アクセス → 残り10日 < 15日 → 新JWT発行（期限: Day 50）
Day 45: アクセス → 残り5日 < 15日 → 新JWT発行（期限: Day 75）
Day 106: 30日以上放置 → JWT期限切れ → /login にリダイレクト → 再ログイン
```

お客さんが週1回でもアクセスしていれば、パスワード再入力は事実上不要♡

## バックエンド側の対応（別リポ — 次フェーズ）

| 対応 | 優先度 |
|------|--------|
| `/api/cases` でJWT role別フィルタ | 高 |
| `projectIds` をJWTに含める | 高 |
| JWTスライディングリフレッシュ（30日 + 自動延長） | 高 |
| 招待時の自動アカウント作成 | 中 |
| パスワードリセット機能 | 低 |

## 検証方法

1. `npm run dev` で起動
2. `/login` にアクセス → Stitch 2デザイン通りのダークログイン画面が表示
3. 各ステートの確認: 初期→入力中→ローディング→エラー/成功
4. 正しい認証情報で送信 → `/` にリダイレクト
5. adminでログイン → 全機能・全案件が見える、プロジェクト管理も表示
6. clientでログイン → プロジェクト管理が非表示、CaseSelectorで自分の案件のみ
7. clientで `/projects` にURL直接アクセス → `/` にリダイレクト
8. `npm run build` でビルドエラーなし
