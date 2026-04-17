# ペタサイト（petabit）案件の復元

## Context

2026-04-16 のモノレポ統合（`787a30a`）時に [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) が新規作成され、`saurus_japan`（顧客案件）のみが登録された。本来自社サイトとして管理されていた **ペタサイト**（`petabit`）は cases.json に移行されず、[src/contexts/AdsSetupContext.jsx:150-155](src/contexts/AdsSetupContext.jsx#L150-L155) にハードコードされたレガシーフォールバックとしてのみ残存している状態。

結果、本番 `/projects` 画面でペタサイトが「プロジェクト一覧」に表示されず、管理者（オペレーター）が自社サイトにアクセスできない。

**目標**：統合前の状態を復元し、管理者パスワード認証後のユーザーのみペタサイトを見られるようにする。サウルスジャパン（顧客案件）は従来通り誰でも見える。

---

## Approach

**cases.json に直接 `petabit` エントリを追加**する最小変更アプローチ。UI からのプロジェクト作成エンドポイント（POST/PUT/DELETE）の実装は本プランのスコープ外（別プランで対応）。

自社/顧客の区別のため `is_internal` フラグを新設し、フロントエンド側で `user.role === 'admin'` のときだけ内部案件を表示する。既存の RBAC パターン（[src/components/CaseSelector.jsx:52-54](src/components/CaseSelector.jsx#L52-L54) の `accessibleCases` フィルタ）と同じ流儀で実装する。

ペタサイトの case login 用パスワードは **管理者パスワード（`APP_PASSWORD`）と同一**にする。これにより、admin が Projects 一覧から選択 → case login モーダル → 管理者パスワード入力でアクセスできる統一フローになる。

### なぜバックエンドで is_internal フィルタしないのか

- 現状のトークン検証 [backend_api.py:1323-1336](backends/ads-insights/web/app/backend_api.py#L1323-L1336) は admin/case_user のロールを区別していない（`_generate_auth_token()` は共通トークンを返す）。
- `GET /api/cases` が返すのは `case_id, name, description` のみで `dataset_id` は含まれない → 内部案件名が非admin に見えても実害なし。
- 将来的に JWT にロール情報を埋め込む改修は別プランで行う。

---

## Changes

### 1. [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json)

petabit エントリを追加（`is_internal: true` 付き）。

```json
[
  {
    "case_id": "saurus_japan",
    "name": "サウルスジャパン",
    "description": "サウルスジャパン広告運用案件",
    "dataset_id": "analytics_311324674",
    "password_hash": "$2b$12$/LW06QHFKMV1OUYQhl5WK.iW91AXXLiE3ykmALNpHvuJI.Fsr//.2",
    "is_active": true,
    "is_internal": false
  },
  {
    "case_id": "petabit",
    "name": "ペタサイト",
    "description": "ペタビット自社サイト",
    "dataset_id": "analytics_311324674",
    "password_hash": "<APP_PASSWORD を bcrypt.hashpw で生成した値>",
    "is_active": true,
    "is_internal": true
  }
]
```

`password_hash` の生成コマンド（ローカルで1回実行）：

```bash
cd backends/ads-insights
python -c "import bcrypt, os; pw = os.environ['APP_PASSWORD'].encode(); print(bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode())"
```

**注意**：サウルスジャパンとペタサイトは同じ `dataset_id` (`analytics_311324674`) を共有している（既存の [backend_api.py:14151-14152](backends/ads-insights/web/app/backend_api.py#L14151-L14152) 参照）。意図通りか現場確認を推奨。別 dataset が必要なら後続で差し替え。

### 2. [backends/ads-insights/web/app/backend_api.py:2516-2521](backends/ads-insights/web/app/backend_api.py#L2516-L2521)

`GET /api/cases` のレスポンスに `is_internal` フラグを含める。

```python
cases = [
    {
        "case_id": c["case_id"],
        "name": c.get("name", c["case_id"]),
        "description": c.get("description", ""),
        "is_internal": c.get("is_internal", False),  # ← 追加
    }
    for c in cases_master
    if c.get("is_active", True)
]
```

### 3. [src/pages/ProjectManagement.jsx](src/pages/ProjectManagement.jsx)

プロジェクト一覧表示直前に `is_internal` フィルタを挿入。`user.role === 'admin'` のみ内部案件を見られる。既存の `cases` 取得ロジック（L21-41付近）の直後に以下を追加：

```jsx
import { useAuth } from '../contexts/AuthContext'
// ...
const { user } = useAuth()
const visibleCases = cases.filter((c) => !c.is_internal || user?.role === 'admin')
// 以降、 cases を参照している箇所を visibleCases に置換
```

### 4. [src/components/CaseSelector.jsx:52-54](src/components/CaseSelector.jsx#L52-L54)

既存の RBAC フィルタに `is_internal` チェックを合流。

```jsx
const accessibleCases = cases
  .filter((c) => !c.is_internal || user?.role === 'admin')
  .filter((c) => (isClient ? canAccessProject(c.case_id) : true))
```

### 5. [src/contexts/AdsSetupContext.jsx:150-155](src/contexts/AdsSetupContext.jsx#L150-L155)（任意）

cases.json に petabit が入ったので、ハードコードされたフォールバックは技術的には不要。ただし「初回ログイン時のデフォルト case 自動選択」という UX は保ちたいので **今回は削除せず残す**。将来、全 case を cases.json 経由で取得するリファクタで削除する。

---

## Verification

### ローカル確認

1. ads-insights バックエンド起動：
   ```bash
   cd backends/ads-insights
   uvicorn web.app.backend_api:app --host 127.0.0.1 --port 8001 --reload
   ```
2. フロント起動：`npm run dev`
3. ブラウザで `http://localhost:3002/projects` を開く
4. **ゲスト状態**：「サウルスジャパン」のみ表示されること
5. **管理者ログイン後**（右上パスワード入力）：「サウルスジャパン」＋「ペタサイト」両方表示されること
6. ペタサイトをクリック → case login モーダルで管理者パスワード入力 → `dataset_id` 取得に成功すること

### API 単体確認

```bash
# トークン取得
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$APP_PASSWORD\"}" | jq -r .token)

# cases 一覧取得（is_internal フラグ確認）
curl -s http://localhost:8001/api/cases -H "Authorization: Bearer $TOKEN" | jq

# petabit case login（管理者パスワードで成功するはず）
curl -s -X POST http://localhost:8001/api/cases/login \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"case_id\":\"petabit\",\"password\":\"$APP_PASSWORD\"}" | jq
```

### 本番デプロイ後

1. Vercel デプロイ反映後、`insight-studio-chi.vercel.app/projects` を確認
2. オペレーターログイン状態で「サウルスジャパン」「ペタサイト」両方表示
3. ペタサイト選択 → データセット接続（`analytics_311324674`）成功

---

## Critical Files

| ファイル | 変更内容 |
|---------|---------|
| [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) | petabit エントリ追加 |
| [backends/ads-insights/web/app/backend_api.py:2516-2521](backends/ads-insights/web/app/backend_api.py#L2516-L2521) | `is_internal` を返却フィールドに追加 |
| [src/pages/ProjectManagement.jsx](src/pages/ProjectManagement.jsx) | `is_internal` 表示フィルタ |
| [src/components/CaseSelector.jsx:52-54](src/components/CaseSelector.jsx#L52-L54) | `is_internal` 表示フィルタ合流 |

---

## Out of Scope（別プランで対応）

- UI の「+ 新規追加」ボタンを動かすための POST/PUT/DELETE `/api/cases` CRUD エンドポイント実装
- JWT にロール情報を埋め込んでバックエンド側で is_internal を厳格にフィルタリング
- [src/contexts/AdsSetupContext.jsx:150-155](src/contexts/AdsSetupContext.jsx#L150-L155) のハードコード削除と cases.json 一本化
