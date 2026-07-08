# プロジェクト管理UI — Stitch→実装 微修正 & RBAC導入計画

## Context
Stitch 2.0でJuicer風のプロジェクト管理UIを生成済み。次はこれを既存Insight Studioに統合し、admin/client分離RBACを実装する。クライアントに他案件を見せないことが最優先。

---

## Phase 1: Stitch出力 → React コンポーネント変換（微修正）

### やること
1. **Stitch出力3フォルダ（配置済み）:**
   - `stitch2/stitch_ad_insights_data_integration (18)/` → プロジェクト一覧ダッシュボード
   - `stitch2/stitch_ad_insights_data_integration (19)/` → 新規プロジェクト作成モーダル
   - `stitch2/stitch_ad_insights_data_integration (20)/` → アクセス共有モーダル
2. **`src/pages/ProjectManagement.jsx`を新規作成** — Stitch出力HTMLを既存Reactコンポーネントパターンに変換

### 微修正4点（Stitch出力からの調整）

| # | 修正箇所 | Before (Stitch) | After (修正) |
|---|---------|-----------------|-------------|
| 1 | ステータス列 | 「クライアント」「停止中」混在 | 統一: 緑ピル「アクティブ」/ グレーピル「停止中」 |
| 2 | データ量単位 | 「12.4 TB」 | 「1.2M行/月」（BigQuery行数ベース） |
| 3 | 英語見出し | 「PROJECT OVERVIEW」 | 「プロジェクト概要」 |
| 4 | サイドバー | DASHBOARD/PROJECTS/TEAM/ANALYTICS/DOCUMENTS | 既存ナビ（LP分析/競合発見/レビュー/広告ウィザード等）に統合、「プロジェクト管理」追加 |

### 既存パターンへの置換

Stitch出力のクラス → 既存CSSクラスに置換:
- `bg-white rounded-xl` → `bg-surface-container-lowest rounded-[0.75rem] panel-card`
- 緑ボタン → `button-primary`
- グレーボタン → `button-secondary`
- ステータスピル → `status-chip` パターン

### 編集ファイル
| ファイル | 変更 |
|---------|------|
| `src/pages/ProjectManagement.jsx` | **新規** — メインページ |
| `src/components/ProjectTable.jsx` | **新規** — テーブルコンポーネント |
| `src/components/ProjectFormModal.jsx` | **新規** — 作成/編集モーダル |
| `src/components/InviteModal.jsx` | **新規** — アクセス共有モーダル |
| `src/App.jsx` | `/projects` ルート追加 |
| `src/components/Layout.jsx` | サイドバーに「プロジェクト管理」追加 |

---

## Phase 2: 認証強化（RBAC準備）

### やること
現在は単一パスワード認証。ユーザーID・ロール概念を追加する準備をフロントエンド側で行う。

### AuthContext.jsx の拡張

```jsx
// 追加するstate・関数
const [user, setUser] = useState(null) // { user_id, email, role, display_name }
const isAdmin = user?.role === 'admin'
const isClient = user?.role === 'client'

// 既存loginAds()は残す（後方互換）
// 追加: loginWithEmail(email, password) → JWT取得
```

### 新規: RbacContext.jsx

```jsx
// 権限判定フック
function useRbac() {
  return {
    canManageProjects,   // admin only
    canViewAllProjects,  // admin only
    canInviteClients,    // admin only
    visibleProjects,     // admin: 全件 / client: 自分のみ
    canAccessProject(id) // client: 自分のprojectIdのみtrue
  }
}
```

### 編集ファイル
| ファイル | 変更 |
|---------|------|
| `src/contexts/AuthContext.jsx` | userオブジェクト、loginWithEmail追加 |
| `src/contexts/RbacContext.jsx` | **新規** — 権限判定 |
| `src/components/Layout.jsx` | ロールでナビ項目を出し分け |
| `src/main.jsx` | RbacProvider でラップ |

---

## Phase 3: バックエンドRBAC対応（ads-insights側）

> **注意:** このPhaseはバックエンドリポ（ads-insights）での作業が必要。Insight Studio側はAPI呼び出しの準備のみ。

### 必要なバックエンド変更
1. `users` テーブル追加 (user_id, email, password_hash, display_name, role)
2. `project_members` テーブル追加 (project_id, user_id, permission)
3. JWTに `role` と `user_id` を含める
4. `GET /api/ads/cases` をロールでフィルタ（clientは自分の案件のみ返す）

### フロントエンド側のAPI準備

`src/api/adsInsights.js` に追加:
```js
export async function loginWithEmail(email, password) { ... }
export async function registerUser(userData) { ... }  // admin用
export async function inviteMember(projectId, email, permission) { ... }
export async function getProjectMembers(projectId) { ... }
export async function removeMember(projectId, userId) { ... }
```

---

## Phase 4: 統合テスト

### テストシナリオ（BigQuery権限連携）

1. **管理者フロー**
   - ログイン → 全プロジェクト一覧表示（サントリー/楽天/トヨタ/任天堂すべて）
   - 新規プロジェクト作成 → BQ Dataset ID入力 → 接続テストOK
   - クライアント招待 → メール入力 → 権限設定 → 招待送信

2. **クライアントフロー**
   - ログイン → 自分のプロジェクトのみ表示（他は見えない）
   - ダッシュボード/グラフ/AI分析 → 自分の案件のデータのみ
   - サイドバー → 「プロジェクト管理」「案件管理」ナビなし
   - 他案件のURL直叩き → 403またはリダイレクト

3. **既存機能への影響確認**
   - 広告ウィザード、Essential Pack、分析グラフが正常動作
   - CaseSelector の案件切替が正常
   - Claude APIキー認証が正常

---

## 実装優先順位

1. **Phase 1** — UI統合（見た目先行。モックデータで動作確認）
2. **Phase 2** — RBACコンテキスト（フロントエンド準備）
3. **Phase 3** — バックエンドRBAC（ads-insights側の別タスク）
4. **Phase 4** — 統合テスト

**Phase 1だけで見れる状態になる。** Phase 2-3は本格運用時に対応。
