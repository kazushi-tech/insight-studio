# Phase 4 Review: Wizard安定化 + テーマ切替 + AI連携 + Multi-BQ整理

## Context

現状コードを確認したところ、元プランは方向性自体は妥当だが、実装前提がいくつか未検証のまま確定事項として書かれていた。
そのまま着手すると、`list_periods` の原因切り分けミス、ウィザード状態の設計不足、Market Lens 連携の前提ズレ、
そして Multi-BQ の過剰スコープで手戻りが発生する可能性が高い。

加えて、レイアウト上部のテーマボタンは UI だけ存在し、状態管理も CSS 切替も未実装だった。
本プランではその点も明示的にスコープへ含める。

---

## レビュー結果

### 1. `list_periods` の原因断定が早い

- 元プランは `URLSearchParams` によるカンマエンコードを主因としているが、これは未検証。
- 提案されていた `encodeURIComponent(query_types)` もカンマを `%2C` にするため、実質的に挙動が変わらない。
- 現在の [SetupWizard.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/SetupWizard.jsx) は API に `QUERY_TYPES[i].label` の日本語表示名を送っている。バックエンドが安定した識別子を期待している場合、URL形式以前にここで不整合が起きる。
- `getFolders()` は取得しているが UI でも後続 API でも使っておらず、バックエンド契約上必要な入力が抜けている可能性もある。

結論:
Phase 1 は「パラメータ形式の決め打ち修正」ではなく、「契約確認 + 最小修正」に置き換える。

### 2. ウィザード完了状態を boolean だけで持つ設計は弱い

- 元プランは `wizardCompleted: boolean` を [AuthContext.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/contexts/AuthContext.jsx) に追加する想定だった。
- ただし、これだけでは「どの query type / 期間で読み込んだか」が失われる。
- 将来 `EssentialPack` / `AnalysisGraphs` / `AiExplorer` がウィザード結果を参照する場合、boolean では再利用できない。
- 認証状態とウィザード状態は責務が異なるため、AuthContext に寄せすぎると肥大化しやすい。
- さらに、現状の「新規プロジェクト」ボタンを `resetWizard()` に流用する案は、将来の本当のプロジェクト概念と衝突する。

結論:
`wizardCompleted` 単体ではなく、`setupState` を持つ専用コンテキストに切り出す。

### 3. Market Lens 連携の前提にズレがある

- [marketLens.js](/c:/Users/PEM%20N-266/work/insight-studio/src/api/marketLens.js) の `getHistory()` は Gemini キーを要求していない。
- そのため「Geminiキー未設定なら Market Lens 連携モードを disabled」にするのは現状 API と整合しない。
- 履歴 JSON 全体をそのまま `generateInsights()` の prompt に流し込む案は、トークン肥大化とノイズ混入のリスクが高い。
- Dashboard はすでに履歴 404 を空状態として扱う前提で組まれているため、AI考察側も「履歴なし」を通常ケースとして扱うべき。

結論:
連携は「履歴の要約を任意で付与する」方式に縮小し、Gemini キー依存は外す。

### 4. Multi-BQ をフロント単独で全面実装するのは危険

- 元プランは [adsInsights.js](/c:/Users/PEM%20N-266/work/insight-studio/src/api/adsInsights.js) の共通 `request()` に `project_id` を自動付与する案だった。
- しかし、`/auth/login`, `/config`, `/health` などプロジェクト非依存のエンドポイントまで一律に `project_id` を混ぜるのは安全ではない。
- `getCases()` が本当に「切替可能なプロジェクト一覧」を返す保証も、現状コードベースだけでは確認できない。
- ウィザード状態のスコープも「ユーザー単位」なのか「プロジェクト単位」なのか、バックエンド契約が必要。

結論:
Multi-BQ はこのフェーズでは「設計スパイク」に格下げし、契約確定後に実装する。

### 5. テーマ切替は実際に未実装

- [Layout.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/components/Layout.jsx) のテーマボタンはクリック処理がなく、アイコンも固定。
- アプリ全体のテーマ状態を持つコンテキストが存在しない。
- [index.css](/c:/Users/PEM%20N-266/work/insight-studio/src/index.css) にはライトテーマのトークンしかない。

結論:
ライトをデフォルトに保ちつつ、永続化付きの `ThemeContext` とダークトークンを追加する。

---

## 修正後のスコープ

| 優先度 | 項目 | 方針 |
|---|---|---|
| P0 | テーマ切替 | 今回実装する |
| P1 | Setup Wizard の契約確認と期間表示修正 | 今回の主タスク |
| P1 | ウィザードゲート | `setupState` ベースで設計修正 |
| P2 | AI考察 × Market Lens履歴連携 | 履歴要約ベースで実装 |
| P3 | Multi-BQ | 今回は設計スパイクのみ |

---

## 修正後の実施プラン

## 1. テーマ切替を先に実装する

**目的**: ライトモードをデフォルトに維持しつつ、ヘッダーのボタンからダークモードへ切り替え可能にする。

### 変更内容

1. 新規 [src/contexts/ThemeContext.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/contexts/ThemeContext.jsx) を追加
   - `theme: 'light' | 'dark'`
   - `toggleTheme()`
   - localStorage key: `insight-studio-theme`

2. [src/main.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/main.jsx) で `ThemeProvider` を app 全体に適用

3. [index.html](/c:/Users/PEM%20N-266/work/insight-studio/index.html) で初期描画前に保存テーマを反映
   - 初回ちらつきを防ぐ
   - 保存値がない場合は常に `light`

4. [src/components/Layout.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/components/Layout.jsx) のテーマボタンを実配線
   - 現在テーマに応じて `dark_mode` / `light_mode` を切替
   - `aria-label` / `title` を付与

5. [src/index.css](/c:/Users/PEM%20N-266/work/insight-studio/src/index.css) に dark theme token を追加
   - 既存 semantic token を dark 用に上書き
   - 既存 UI で使われている `bg-white`, `bg-slate-50`, `text-[#1A1A2E]` などのライト固定クラスを dark 時だけ補正

### 検証

- 初回表示はライトモードで始まる
- ヘッダーボタンでライト / ダークが切り替わる
- リロード後も選択テーマが維持される

---

## 2. Setup Wizard の契約確認と期間表示を修正する

**目的**: 期間表示バグを、推測ではなく実契約に基づいて直す。

### 方針

1. `QUERY_TYPES` に `id` と `label` を分ける
   - `label` は UI 表示
   - `id` は API に送る安定識別子

2. [src/pages/SetupWizard.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/SetupWizard.jsx) で `listPeriods()` / `loadData()` に送る値を `label` ではなく `id` ベースへ寄せる

3. `listPeriods()` のレスポンス抽出を強化する
   - `data.periods`
   - `data.results`
   - `data.available_periods`
   - `data.data`
   - array fallback

4. URL形式の変更は「必要と確認できた場合のみ」行う
   - repeated param (`query_types=a&query_types=b`) が必要ならその時点で変更
   - カンマエンコードだけを原因と決め打ちしない

5. `getFolders()` の役割を確認する
   - 使わないなら削除
   - 必須契約なら UI に組み込む

### 対象ファイル

- [src/pages/SetupWizard.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/SetupWizard.jsx)
- [src/api/adsInsights.js](/c:/Users/PEM%20N-266/work/insight-studio/src/api/adsInsights.js)

### 検証

- `/api/ads/list_periods` の request query を確認
- レスポンス形状を確認
- 期間カードが表示されることを確認
- 同じ query type 群で `loadData()` まで成功することを確認

---

## 3. ウィザードゲートは `setupState` ベースに作り直す

**目的**: ウィザード未完了時の導線を制御しつつ、将来の再利用に耐える状態設計にする。

### 方針

新規 `AdsSetupContext` を追加し、boolean ではなくセットアップ情報を保持する。

```javascript
setupState = {
  queryTypes: string[],
  period: string,
  completedAt: string,
}
```

### 変更内容

1. 新規 `src/contexts/AdsSetupContext.jsx`
   - `setupState`
   - `completeSetup(payload)`
   - `resetSetup()`
   - localStorage 永続化

2. [src/pages/SetupWizard.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/SetupWizard.jsx)
   - `loadData()` 成功時点で `completeSetup()`
   - Step 2 完了後に `/ads/pack` へ遷移

3. [src/App.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/App.jsx)
   - `/ads/pack`, `/ads/graphs`, `/ads/ai` に `SetupGuard` を追加

4. [src/components/Layout.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/components/Layout.jsx)
   - ガード対象リンクを視覚的に disabled 表示
   - 現在の「新規プロジェクト」ボタンは `resetSetup()` 用に流用しない
   - 必要なら文言を「新しいセットアップ」に変更して責務を分離

5. 認証解除時のリセット
   - `logoutAds()` のタイミングで `setupState` もクリアするか、Context 間連携を追加

### 検証

- 未完了時は `/ads/pack`, `/ads/graphs`, `/ads/ai` へ直接アクセスしても `/ads/wizard` に戻る
- 完了後は遷移可能
- リロード後もセットアップ状態が維持される
- ログアウト後はガードが再度有効になる

---

## 4. AI考察 × Market Lens は「履歴要約」連携にする

**目的**: AI考察で Market Lens の情報も参照できるようにしつつ、ノイズと依存関係を増やしすぎない。

### 方針

- `getHistory()` は Gemini キー不要で取得
- 履歴 JSON 全投げではなく、最新 3-5 件を短いテキストへ正規化
- 利用は opt-in の context mode にする

### 変更内容

1. [src/pages/AiExplorer.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/AiExplorer.jsx)
   - `contextMode: 'ads-only' | 'ads-with-ml'`
   - `mlContextSummary`
   - 接続状態チップ

2. [src/api/marketLens.js](/c:/Users/PEM%20N-266/work/insight-studio/src/api/marketLens.js) は既存のまま利用

3. 履歴整形ヘルパーを追加
   - タイトル
   - URL
   - スコア
   - 作成日
   - 必要最小限の要約のみ採用

4. 送信時に要約済みコンテキストを prompt へ付加

```javascript
const enrichedPrompt = mlContextSummary
  ? `[Market Lens Summary]\n${mlContextSummary}\n\n[Question]\n${prompt}`
  : prompt
```

### 検証

- 履歴があるときだけ連携モードが実質的に機能する
- 履歴 404 / 空配列でも通常チャットが壊れない
- Gemini キー未設定でも Market Lens 履歴参照は可能

---

## 5. Multi-BQ は設計スパイクに留める

**目的**: 将来の複数 BigQuery 対応を、フロント単独の仮説実装で壊さない。

### このフェーズでやること

1. `project_id` を受け取る必要があるエンドポイントを整理する
   - `folders`
   - `list_periods`
   - `load`
   - `generate_insights`
   - `config` / `auth` / `health` は別扱いの可能性が高い

2. `getCases()` のレスポンス契約を確認する
   - 本当に「切替プロジェクト一覧」として使えるかを確認

3. ウィザード状態が project-scoped か user-scoped かを決める

4. 実装は次フェーズへ送る
   - `ProjectContext` を追加するのは契約確定後
   - `request()` の自動付与は endpoint ごとの適用範囲が決まってから

### このフェーズでやらないこと

- 共通 `request()` への一律 `project_id` 差し込み
- 「新規プロジェクト」ボタンの意味確定
- localStorage key の project 単位化

---

## Agent Team 案

タスク量が大きい場合は、以下の分担で並行化する。

1. Agent A: テーマ基盤
   - `ThemeContext`, `Layout`, `index.css`, `index.html`

2. Agent B: Setup Wizard 契約確認
   - `SetupWizard`, `adsInsights.js`

3. Agent C: ガードと状態設計
   - `AdsSetupContext`, `App`, `Layout`

4. Agent D: AI考察連携
   - `AiExplorer`, 必要なら `marketLens.js`

Multi-BQ は Agent を立てる前に契約確認を終えること。

---

## 変更対象ファイル（修正版）

| ファイル | 目的 |
|---|---|
| [src/contexts/ThemeContext.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/contexts/ThemeContext.jsx) | テーマ状態の新規追加 |
| [src/main.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/main.jsx) | ThemeProvider 組み込み |
| [index.html](/c:/Users/PEM%20N-266/work/insight-studio/index.html) | 初期テーマ適用 |
| [src/index.css](/c:/Users/PEM%20N-266/work/insight-studio/src/index.css) | dark token と互換スタイル |
| [src/components/Layout.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/components/Layout.jsx) | テーマボタン、ナビ状態制御 |
| [src/pages/SetupWizard.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/SetupWizard.jsx) | query type 契約修正、完了時の state 記録 |
| [src/api/adsInsights.js](/c:/Users/PEM%20N-266/work/insight-studio/src/api/adsInsights.js) | listPeriods の必要最小修正 |
| `src/contexts/AdsSetupContext.jsx` | セットアップ状態の新規追加 |
| [src/App.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/App.jsx) | SetupGuard 追加 |
| [src/pages/AiExplorer.jsx](/c:/Users/PEM%20N-266/work/insight-studio/src/pages/AiExplorer.jsx) | Market Lens 履歴要約連携 |

---

## 検証チェックリスト

1. テーマボタンが実際に反応する
2. ダークモード切替後にリロードしても維持される
3. Setup Wizard で選択後に期間一覧が表示される
4. Wizard 完了前は `/ads/pack`, `/ads/graphs`, `/ads/ai` に直アクセスできない
5. Wizard 完了後は各ページへ遷移できる
6. AI考察で Market Lens 履歴要約の有無を切り替えられる
7. 履歴 404 / empty でも AI考察は通常動作する
8. Multi-BQ は設計メモ止まりで、本番コードへ未検証な `project_id` 差し込みをしない
9. `npm run build` が成功する
