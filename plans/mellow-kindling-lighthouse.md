# 設定ページ実用化リデザイン

## Context

現在の設定ページには3つのトグル（自動アーカイブ・通知設定・データ連携）があるが、バックエンドにこれらの機能は実装されておらず、事実上の飾りである。一方で、ユーザー表示名の変更、Gemini APIキーの管理、考察スタジオ接続の管理など、実際に必要な設定項目が欠けている。

**目的:** 非機能のダミー設定を削除し、実用的な設定項目に置き換える。

---

## 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src/contexts/UserProfileContext.jsx` | 新規 | 表示名をlocalStorageで管理するContext |
| `src/main.jsx` | 修正 | UserProfileProviderを追加 |
| `src/pages/Settings.jsx` | 全面書き換え | 4セクション構成の実用設定ページ |
| `src/components/Layout.jsx` | 修正 | ハードコード「田中一郎」を動的表示に |
| `src/api/adsInsights.js` | 修正 | 不要なgetConfig/saveConfig関数を削除 |

---

## 実装詳細

### 1. `src/contexts/UserProfileContext.jsx`（新規）

ThemeContext.jsxと同じパターンで作成:
- localStorage key: `insight-studio-display-name`
- デフォルト値: `'田中 一郎'`（既存動作を維持）
- exports: `UserProfileProvider`, `useUserProfile`
- 提供値: `displayName`, `setDisplayName(name)`, `avatarInitial`（名前の先頭1文字）
- `setDisplayName`: trim後、空なら`'名前未設定'`にフォールバック、localStorageに永続化

### 2. `src/main.jsx`（修正）

```
<ThemeProvider>
  <AuthProvider>
    <UserProfileProvider>      ← 追加
      <AdsSetupProvider>
        <App />
      </AdsSetupProvider>
    </UserProfileProvider>      ← 追加
  </AuthProvider>
</ThemeProvider>
```

### 3. `src/pages/Settings.jsx`（全面書き換え）

既存のトグル設定・getConfig/saveConfig連携をすべて削除し、以下4セクション構成に:

**ヘッダー:** タイトル「設定」、サブタイトルを「プロフィールや接続設定を管理できます。」に変更

**カード1 — プロフィール** (icon: `person`)
- 「表示名」テキスト入力（maxLength=20）
- ローカルstateで編集、「保存」ボタンでsetDisplayName呼び出し
- 一時的な「保存しました」インジケーター（3秒で消える）

**カード2 — API設定** (icon: `key`)
- Gemini APIキーの表示（マスク: 先頭4文字 + ••••• + 末尾4文字）
- キー設定済み: 「変更」「削除」ボタン（削除はwindow.confirm）
- 未設定: password入力 + 「保存」ボタン
- AuthContextの`geminiKey`/`setGeminiKey`/`hasGeminiKey`を使用

**カード3 — 接続管理** (icon: `cloud`)
- 考察スタジオの接続状態表示（接続済/未接続バッジ）
- 接続済み: 「切断する」ボタン（window.confirm → `logoutAds()`）
- 未接続: パスワード入力 + 「ログイン」ボタン（`loginAds(password)`）
- AuthContextの`isAdsAuthenticated`/`loginAds`/`logoutAds`を使用

**カード4 — テーマ** (icon: `palette`)
- ダークモードトグル（既存Toggleコンポーネントを再利用）
- ThemeContextの`isDark`/`toggleTheme`を使用

カード共通スタイル: `bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-6`

### 4. `src/components/Layout.jsx`（修正）

- import追加: `useUserProfile` from `'../contexts/UserProfileContext'`
- Layout関数内で `const { displayName, avatarInitial } = useUserProfile()`
- L411: `田中 一郎` → `{displayName}` + `truncate`クラス追加
- L414-415: アバターの`田` → `{avatarInitial}`
- L412: `管理者` はそのまま維持（ロール管理システムは存在しない）

### 5. `src/api/adsInsights.js`（修正）

- `getConfig`関数と`saveConfig`関数を削除（Settings.jsxからのみ使用されていた）

---

## 検証手順

1. `npm run build` — ビルド成功を確認
2. `npm run dev` で開発サーバー起動
3. 設定ページ（/settings）を開く:
   - プロフィール名を変更 → ヘッダー右上のアバター名が即座に反映されること
   - ページリロード後も名前が保持されること
   - Gemini APIキーの表示・変更・削除が動作すること
   - 考察スタジオの接続/切断が動作すること
   - ダークモードトグルが動作すること
4. 他のページに影響がないことを確認（ダッシュボード等を巡回）
