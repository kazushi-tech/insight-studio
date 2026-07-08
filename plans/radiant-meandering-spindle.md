# 認証フロー統合 — レビュー指摘修正（3件）

## Context

認証フロー統合の実装レビューで3つの問題が見つかった。
全て修正しないと認証フローが正常に動作しない。

---

## Fix 1: `petabit` 案件を cases.json に追加（Critical）

**問題:** フロントエンドが自動選択する `petabit` 案件がバックエンドの cases.json に存在しない。
CaseAuthModal でパスワード入力 → `/api/cases/login` → 404 エラーになる。

**ファイル:** `tmp_ads_insights_repo/cases/cases.json`

**修正:** 既存の `test_case` に加えて `petabit` 案件を追加する。

```json
[
    {
        "case_id": "test_case",
        "name": "テスト案件",
        "...": "（既存のまま）"
    },
    {
        "case_id": "petabit",
        "name": "ペタビット",
        "description": "ペタビット広告分析",
        "dataset_id": "analytics_311324674",
        "password_hash": "<test_caseと同じハッシュをコピー>",
        "is_active": true,
        "data_folder_hint": "ペタビット",
        "report_type": "search_ads",
        "created_at": "2026-04-02T00:00:00"
    }
]
```

`password_hash` は `test_case` と同じ値（= APP_PASSWORD `aQWkTCzrYF6b4xiV3=na19ID` のbcryptハッシュ）をそのままコピーすればよい。

---

## Fix 2: CaseManagement 未認証カードのたらい回し解消（Medium）

**問題:** 未認証時「設定ページへ」ボタンがあるが、Settings ページにはもうパスワード入力欄がない（ガイドメッセージに置換済み）。ユーザーがたらい回しになる。

**ファイル:** `src/pages/CaseManagement.jsx` — 行 235-268 付近の未認証カード

**修正:** 「設定ページへ」ボタンを削除し、案件セレクターへの誘導メッセージに変更:

```jsx
{!isAdsAuthenticated && (
  <div className="space-y-4">
    <div className="bg-surface-container-lowest p-6 rounded-2xl">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
          <span className="material-symbols-outlined">lock</span>
        </div>
        <h4 className="text-lg font-bold japanese-text">認証が必要です</h4>
      </div>
      <p className="text-sm text-on-surface-variant japanese-text">
        案件一覧を管理するには、ヘッダーの案件セレクターから案件を選択し、パスワードを入力して認証してください。
      </p>
    </div>

    {currentCase && (
      <div className="bg-surface-container-lowest p-6 rounded-2xl">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-lg text-on-surface-variant">folder_open</span>
          <div>
            <p className="text-sm font-bold japanese-text">現在選択中の案件</p>
            <p className="text-sm text-on-surface-variant japanese-text">{currentCase.name}</p>
          </div>
        </div>
      </div>
    )}
  </div>
)}
```

変更点:
- `navigate('/settings')` ボタンを削除
- `useNavigate` の import と `navigate` 変数が不要になるなら削除（他で使っていなければ）
- メッセージを「ヘッダーの案件セレクターから案件を選択し、パスワードを入力して認証してください」に変更

---

## Fix 3: グローバルログアウト時に CASE_AUTH_KEY をクリア（Medium）

**問題:** `logoutAds()` 実行後も `localStorage` の `insight-studio-case-authenticated` が `'true'` のまま残る。次回ページロード時に `isCaseAuthenticated = true`（stale state）になる。

**ファイル:** `src/contexts/AdsSetupContext.jsx`

**修正:** `onAdsLogout` コールバックで `CASE_AUTH_KEY` もクリアする。

現在（行 193-195）:

```javascript
useEffect(() => {
  return onAdsLogout(resetSetup)
}, [onAdsLogout, resetSetup])
```

修正後:

```javascript
useEffect(() => {
  return onAdsLogout(() => {
    resetSetup()
    setIsCaseAuthenticated(false)
    localStorage.removeItem(CASE_AUTH_KEY)
  })
}, [onAdsLogout, resetSetup])
```

---

## 検証手順

1. localStorage を全クリアしてページリロード
2. ペタビットが自動選択されるが `isCaseAuthenticated = false` であること確認
3. CaseSelector を開く → 「ペタビット」と「テスト案件」が表示される
4. ペタビットを選択 → CaseAuthModal 表示 → パスワード `aQWkTCzrYF6b4xiV3=na19ID` 入力
5. 認証成功 → `isAdsAuthenticated = true` + `isCaseAuthenticated = true`
6. `/cases` → 案件一覧テーブルが表示される
7. Settings → 「切断する」ボタン押下 → `isAdsAuthenticated = false` + `isCaseAuthenticated = false`
8. `/cases` → 未認証カードが表示、「設定ページへ」ボタンではなくガイドメッセージが表示
