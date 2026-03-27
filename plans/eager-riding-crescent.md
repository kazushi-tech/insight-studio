# 改訂バグフィックス計画: 認証失効・テーブル列幅・無意味グラフ

## 0. レビュー結論

元プランの問題意識自体は妥当です。特に以下の 3 点は直す価値があります。

1. AI考察で stale token を握ったまま 401 を踏む
2. 要点パックの table で数値列が必要以上に広がる
3. 全値が同じ chart group が表示・AI文脈へ混入する

ただし、そのまま進めるのは危険です。元プランには次の修正が必要です。

- `health()` を起動時 token 検証に使う案は不適切
  - `ads-insights` reference backend では `/api/health` は public path
  - したがって 200 が返っても token 有効性の証拠にならない
- 401 を全 endpoint 一律で logout 扱いする案は危険
  - `/auth/login` の失敗まで session expired と誤判定する
  - proactive probe を入れる場合も、handler を抑止しないと二重 logout になる
- table 修正の主因は `min-w-full` 単体ではない
  - 主因は `MarkdownRenderer` の列幅ヒューリスティクス
  - reference も `min-width: 100%` を維持している
- chart の「無意味」判定を dataset ごとの定数判定で切るのは強すぎる
  - 複数 dataset がそれぞれ一定値でも、dataset 間で値が異なれば比較として意味がある

この改訂版は、上記を踏まえて実装境界と検証観点を修正したものです。

---

## 1. 対象と前提

### 対象症状

- AI考察ページで 401 後に stale session のまま UI が残る
- 要点パックの markdown table で数値列が横に伸びすぎる
- 全値が同じ chart group が graphs / AI context に残る

### 対象ファイル

- `src/api/adsInsights.js`
- `src/contexts/AuthContext.jsx`
- `src/components/Layout.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/components/MarkdownRenderer.jsx`
- `src/utils/adsReports.js`

### reference

- `tmp_ads_insights_repo/index.html`
- `tmp_ads_insights_repo/web/app/backend_api.py`

---

## 2. Fix 1: 401 / 認証失効ハンドリング

### 結論

401 の検知と session 破棄は API レイヤーで一元化する。  
起動時の token 妥当性確認は `health()` ではなく、認証必須 endpoint で行うか、無理に proactive validation を入れず request-time 401 検知に寄せる。

### 修正ファイル

- `src/api/adsInsights.js`
- `src/contexts/AuthContext.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/components/Layout.jsx`

### 実装方針

#### A. `src/api/adsInsights.js`

- `request()` に 401 検知を追加する
- ただし「認証付き request で発生した 401」だけを auth-expired とみなす
- `login()` や proactive probe は handler 対象から外す
- error には最低限以下を付与する
  - `status`
  - `body`
  - `isAuthError`

推奨形:

```js
let onAuthError = null

export function setOnAuthError(handler) {
  onAuthError = handler
}

async function request(path, options = {}) {
  const {
    skipAuth = false,
    suppressAuthErrorHandler = false,
    ...fetchOptions
  } = options
  const didSendAuth = !skipAuth && Boolean(authToken)
  const res = await fetch(...)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(body.detail || `Ads Insights API error: ${res.status}`)
    error.status = res.status
    error.body = body
    error.isAuthError = res.status === 401 && didSendAuth

    if (error.isAuthError && !suppressAuthErrorHandler) {
      onAuthError?.(error)
    }

    throw error
  }
  return res.json()
}
```

#### B. 起動時 token 検証

- `health()` を `validateToken()` に使わない
- 選択肢は 2 つ

1. 推奨:
   - 認証必須の軽量 endpoint を使って検証する
   - 既存 endpoint を使うなら副作用のない GET に限定する
   - その request では `suppressAuthErrorHandler: true` を使う
2. 最小修正:
   - proactive validation は入れず、全 API 呼び出しの 401 を request-time で回収する

補足:

- 今回の主問題は「起動直後の stale token 判定」より「401 を踏んだ後も local state が生き続けること」
- そのため P0 は request-time 401 一元化で十分
- 起動時検証は protected probe が用意できる場合のみ採用

#### C. `src/contexts/AuthContext.jsx`

- `useEffect` で `setOnAuthError(() => logoutAds())` を登録する
- cleanup で handler を解除する
- `logoutAds()` は idempotent に扱う
  - token が既に null でも安全
  - 同時多発 401 でも破綻しない

注意:

- 既存の `onAdsLogout` は downstream reset の fan-out に使えている
- したがって API layer は「認証失効通知」、AuthContext は「session state 破棄」に責務を分ける

#### D. ページ側の error 文言統一

- `src/pages/AiExplorer.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`

- `handleSend()` / `handleRefreshReport()` の error 表示を 401 専用文言に寄せる
- bundle 再取得系の `catch` でも 401 専用文言を使う
- ただし auth state 自体の破棄は API + AuthContext 側で行う

推奨文言:

- `認証エラー: セッションが切れました。再ログインしてください。`

#### E. `login()` の扱い

- `login()` は stale bearer を送らないよう `skipAuth: true` で呼ぶ
- 誤パスワード時は通常の login error として扱い、logout fan-out を起こさない

#### F. `src/components/Layout.jsx`

- 表示ラベルを `接続中` から `接続済` に変更する

### 受け入れ条件

- stale token 保存状態で protected API を叩くと、自動的にログアウト状態へ遷移する
- `/auth/login` の認証失敗では setup / reportBundle が消えない
- `AdsSetupContext` の reset が連動し、古い `reportBundle` が残らない
- `AiExplorer` / `EssentialPack` / `AnalysisGraphs` に raw backend message ではなく認証切れ文言が出る
- 認証済み表示は `接続済` になる

---

## 3. Fix 2: 要点パック table の列幅調整

### 結論

`min-w-full` を単純に削除するのではなく、reference に寄せて「wrapper 内 scroll は維持しつつ、列ごとの最小幅を詰める」方針に変更する。

### 修正ファイル

- `src/components/MarkdownRenderer.jsx`

### 実装方針

#### A. table wrapper は維持

- 外側の `overflow-x-auto` はそのまま維持
- table は reference 寄りに以下のどちらかへ寄せる
  - `w-max min-w-full table-auto`
  - または同等の CSS

意図:

- 狭い table は container 幅を下回らない
- 広い table は wrapper 内だけで横スクロールする

#### B. 主修正は `getColumnClass()` の見直し

現在の主因は以下です。

- 1列目 / text列: `min-w-[18rem] max-w-[32rem]`
- 日付列: `min-w-[7rem]`
- 数値列: `min-w-[6.5rem]`
- デフォルト列: `min-w-[8rem]`

これを、以下のように現実的な幅へ縮める。

推奨目安:

- text / title / url 系: `min-w-[14rem] max-w-[28rem]`
- date / period 系: `min-w-[6rem]`
- numeric 系: `min-w-[4.5rem]`
- default: `min-w-[5.5rem]`

#### C. nowrap / wrap の方針

- numeric cell の `whitespace-nowrap` は維持してよい
- text cell は `break-words` / `overflow-wrap:anywhere` を維持
- 必要なら 1 列目だけ hover 時展開を追加するが、今回は必須ではない

#### D. やらないこと

- `w-auto` のみへ変えて narrow table を左寄せ縮小させる
- page 全体の横スクロールを再発させる変更
- first column の可読性を落とす過剰圧縮

### 受け入れ条件

- 数値列が現状より明確にコンパクトになる
- text 列は読めるまま保たれる
- table の overflow は wrapper 内だけで発生する
- page root の横スクロールは発生しない

---

## 4. Fix 3: 無意味 chart group のフィルタ

### 結論

判定は「各 dataset が定数か」ではなく、「表示対象 group 全体に数値的な変化や差があるか」で行う。

### 修正ファイル

- `src/utils/adsReports.js`

### 実装方針

#### A. `isMeaningfulChartGroup()` を追加

ルール:

- 数値が 1 点もない group は `false`
- 数値が 1 点だけの group は `true`
- 複数の数値があり、その全てが同一値なら `false`
- dataset ごとには定数でも、group 全体で異なる値が混在するなら `true`

推奨形:

```js
function toFiniteNumber(value) {
  if (value == null || value === '') return null
  const normalized =
    typeof value === 'string' ? Number(value.trim().replace(/,/g, '').replace(/[%％]$/, '')) : Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

export function isMeaningfulChartGroup(group) {
  const values = (Array.isArray(group?.datasets) ? group.datasets : [])
    .flatMap((dataset) => (Array.isArray(dataset?.data) ? dataset.data : []))
    .map(toFiniteNumber)
    .filter((value) => value != null)

  if (values.length === 0) return false
  if (values.length === 1) return true

  const first = values[0]
  return values.some((value) => value !== first)
}
```

#### B. 適用箇所

- `getDisplayChartGroups()`
- `buildAiChartContext()`

方針:

- 生データ保持 (`buildAdsReportBundle`) では filter しない
- 表示用 / AI 送信用の派生段階で filter する

#### C. 注意点

- `periodFilter === 'all'` では `mergeChartGroupsByTitle()` 後の group に対して判定する
- これにより、period ごとに dataset が増えた merged group の比較価値を落としにくい

### 受け入れ条件

- 100 / 100 / 100 のような完全一定 chart は非表示になる
- 100 / 0 のように dataset 間で差がある比較は残る
- AI に送る `ai_chart_context` からも完全一定 chart が落ちる

---

## 5. 実装順

1. `adsInsights.js` に 401 一元検知を入れる
2. `login()` / proactive probe の例外条件 (`skipAuth`, `suppressAuthErrorHandler`) を入れる
3. `AuthContext.jsx` で auth-expired handler を登録する
4. `AiExplorer.jsx` / `EssentialPack.jsx` / `AnalysisGraphs.jsx` の 401 文言を調整する
5. `Layout.jsx` の `接続済` 表記を直す
6. `MarkdownRenderer.jsx` の列幅ヒューリスティクスを調整する
7. `adsReports.js` に meaningful filter を追加し、display / AI context に適用する
8. build / lint / 手動確認を行う

---

## 6. Agent Team 推奨分担

この修正は UI / auth / data-shaping が混在するため、並列に進めるなら以下が安全です。

### Lead / Integrator

- 実装境界の固定
- 401 flow と chart filter の責務整理
- 最終 diff review

### Agent 1: Auth Flow Worker

- `src/api/adsInsights.js`
- `src/contexts/AuthContext.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/components/Layout.jsx`

### Agent 2: Markdown Table Worker

- `src/components/MarkdownRenderer.jsx`
- table width / wrapper / column heuristics の調整

### Agent 3: Chart Semantics Worker

- `src/utils/adsReports.js`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- display / AI context 両方で filter 影響確認

### Agent 4: QA / Regression Verifier

- stale token scenario
- pack table width
- graphs / AI regression
- `npm run lint`
- `npm run build`

---

## 7. Skills について

現セッションの skill catalog には、この修正に直接効く frontend/auth 専用 skill はありません。  
そのため今回は skill 前提ではなく、agent team と repo-grounded review を優先します。

---

## 8. 検証手順

1. `npm run lint`
2. `npm run build`
3. stale token を `localStorage` に残してリロードするか、ログイン後に server 側 token を失効させて protected API を発火
4. 401 で自動 logout され、setup / reportBundle がクリアされることを確認
5. 誤パスワードで `/auth/login` を叩いても logout fan-out が起きないことを確認
6. `/ads/ai` / `/ads/pack` / `/ads/graphs` で認証切れ専用メッセージが出ることを確認
7. `/ads/pack` で数値列が過度に広がらないことを確認
8. page 全体の横スクロールが発生しないことを確認
9. `/ads/graphs` で完全一定 chart が消えることを確認
10. AI考察 payload の `ai_chart_context` からも完全一定 chart が除外されることを確認

---

## 9. 一言まとめ

このタスクはそのまま進めてよいですが、元プランのままでは 401 検知の根拠と table/chart の修正境界がずれています。  
特に `health()` 検証案は撤回し、401 は API レイヤーで回収、table は列幅設計中心、chart は group 全体の情報量で判定する方針に修正して進めます。
