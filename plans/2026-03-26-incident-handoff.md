# Insight Studio Incident Handoff

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**ブランチ:** `master`  
**現在の HEAD:** `e6e16b68293b809e15fcdea555aac8550d0e6ebf`  
**状態:** ローカル修正あり、未コミット、未デプロイ

---

## 1. 今回の依頼

ユーザーから以下の報告があった。

- 広告考察 `Setup Wizard` で分析期間を選択できない
- `Lens AI` がエラー
- `競合発見` / `LP比較分析` / `クリエイティブ診断` も全部エラー

添付スクリーンショットでは以下の症状を確認した。

- `/ads/wizard`
  - Step 2 で `利用可能な期間がありません。`
- `/discovery`
  - `Market Lens API error: 404`
- `/compare`
  - `Market Lens API error: 404`

---

## 2. 直前までの背景

このセッションより前に、以下はすでに対応済みだった。

- `plans/foamy-rolling-giraffe.md` のレビューと全面改稿
- ダークモード切り替えの実装
- `ThemeContext` 配線
- `Layout` のテーマボタン修正
- `index.html` の初期テーマ反映
- `src/index.css` の dark token 追加

その後、Claude 側の Phase 4 実装サマリーに対してレビューを進めていた段階で、今回の本番症状の報告が入った。

---

## 3. まず判明したこと

### 3.1 Setup Wizard の回帰疑い

`Phase 4` で `SetupWizard.jsx` が以下のように変更されていた。

- 以前:
  - `query_types` に `QUERY_TYPES[i].label` の日本語ラベルを送信
- 変更後:
  - `query_types` に `QUERY_TYPES[i].id` の英語 ID を送信

変更ファイル:

- `src/pages/SetupWizard.jsx`

この ID 群は frontend 側の推測値であり、バックエンド契約確認なしで切り替わっていた。
そのため `list_periods` が空を返す、もしくは実質無効扱いになる可能性が高いと判断した。

### 3.2 Market Lens 側は frontend だけの不具合ではない

`src/api/marketLens.js` は今も以下の旧 API 前提になっている。

- `POST /api/ml/scan`
- `POST /api/ml/discovery/analyze`
- `POST /api/ml/review`
- `GET /api/ml/history`
- `GET /api/ml/health`

しかし、本番でこの系統が 404 になっていたため、プロキシ先の現況を確認した。

---

## 4. 実施した live probe

### 4.1 Ads 側

確認日: **2026-03-26**

- `https://insight-studio-chi.vercel.app/api/ads/health`
  - `200 OK`
  - Ads 側のプロキシ自体は生きている

### 4.2 Market Lens 側

確認日: **2026-03-26**

- `https://insight-studio-chi.vercel.app/api/ml/health`
  - `404`
- `https://market-lens-ai.vercel.app/api/health`
  - `404`
- `https://market-lens-ai.vercel.app/api/history`
  - `404`
- `https://market-lens-ai.vercel.app/api/scan`
  - `404`
- `https://market-lens-ai.vercel.app/api/discovery/analyze`
  - `404`
- `https://market-lens-ai.vercel.app/api/review`
  - `404`

結論:

- `vercel.json` と `vite.config.js` の現在の接続先
  - `https://market-lens-ai.vercel.app/api/:path*`
- ここには、Insight Studio が期待している API surface が存在しない

### 4.3 Market Lens frontend bundle 解析

以下の bundle を調査した。

- `https://market-lens-ai.vercel.app/assets/index-B8yTl96L.js`

ここから抽出できた hard-coded URL:

- `https://marketlens-ai-backend.onrender.com/api/analyze/`

これは重要な発見で、現行の Market Lens 公開 frontend は Vercel の `/api/*` ではなく、
別の Render backend を直接叩く構成になっている可能性が高い。

### 4.4 Render backend probe

確認日: **2026-03-26**

- `GET https://marketlens-ai-backend.onrender.com/api/analyze/`
  - `405`
- `GET https://marketlens-ai-backend.onrender.com/api/analyze/health`
  - `404`
- `GET https://marketlens-ai-backend.onrender.com/api/analyze/history`
  - `404`
- `GET https://marketlens-ai-backend.onrender.com/api/analyze/discovery`
  - `404`
- `GET https://marketlens-ai-backend.onrender.com/api/analyze/review`
  - `404`

bundle 周辺コードから読み取れた内容:

- 現行の Market Lens は `file` と `query` を `FormData` で送る単発の `analyze` API を使っている
- Insight Studio が前提としている `scan / discovery / review / history` 契約とは別物

結論:

- Market Lens 側は「旧 API がなくなった」または「別 backend に移行して契約が変わった」可能性が高い
- Insight Studio 側だけでは、正しい接続先を推測し切れない

---

## 5. Setup Wizard について追加で判明したこと

### 5.1 外部からの `list_periods` 直叩き

以下を ID とラベルの両方で試した。

- `query_types=pv`
- `query_types=PV分析`

結果:

- どちらも `401`

つまり、CLI からは ads 認証トークンなしでは backend 契約を確定できない。
ただし少なくとも、

- 「英語 ID に切り替えたことが安全」とは言えない
- frontend だけで片方に固定するのは危険

という判断は維持した。

### 5.2 Setup 状態管理の副作用もあった

レビュー中に以下も発見した。

- `AuthContext.jsx`
  - `onLogoutCallbacks` が render ごとに初期化される構造
  - `onAdsLogout(resetSetup)` の信頼性が低い
- `Layout.jsx`
  - `新しいセットアップ` で context は消えるが、同一ルート上の wizard ローカル state は必ずしも初期化されない
- `App.jsx`
  - `SetupGuard` が `isSetupComplete` しか見ていなかった
  - 認証切れと setup 永続化のズレが起きうる

---

## 6. ローカルで入れた修正

以下は **まだコミットしていないローカル変更**。

### 6.1 `src/pages/SetupWizard.jsx`

対応内容:

- `listPeriods()` を 1 パターンに固定しない
- 選択 query type を以下で順番に試す
  - `id` 配列
  - `id` のカンマ区切り
  - `label` 配列
  - `label` のカンマ区切り
- `extractPeriods()` を array-safe に修正
  - `periods`
  - `results`
  - `available_periods`
  - `data`
  - `items`
  - 直接 array
- 取得成功した query_types を `resolvedQueryTypes` として保持し、そのまま `loadData()` に再利用
- `新しいセットアップ` 押下時の route state (`resetAt`) を受けて wizard ローカル state を初期化
- 認証が外れた場合にも wizard state を初期化

意図:

- backend 契約が不明でも、今回の regression を最小化する
- 少なくとも「英語 ID に固定したせいで壊れた」ケースを回避する

### 6.2 `src/api/adsInsights.js`

対応内容:

- `listPeriods()` 用に `toQueryString()` を追加
- `query_types` が配列でも repeated param として送れるようにした

### 6.3 `src/contexts/AuthContext.jsx`

対応内容:

- `onLogoutCallbacks` を `useRef(new Set())` 化
- `onAdsLogout()` が unsubscribe を返すよう修正
- `setGeminiKey`, `loginAds`, `logoutAds` を `useCallback` 化

意図:

- logout subscription の破綻を防ぐ

### 6.4 `src/contexts/AdsSetupContext.jsx`

対応内容:

- `useEffect(() => onAdsLogout(resetSetup))` を unsubscribe 返却型に変更

### 6.5 `src/App.jsx`

対応内容:

- `SetupGuard` が以下の両方を確認するよう修正
  - `isAdsAuthenticated`
  - `isSetupComplete`

### 6.6 `src/components/Layout.jsx`

対応内容:

- gated path の unlock 条件を `認証済み && setup 完了` に変更
- `新しいセットアップ` ボタン押下で
  - `resetSetup()`
  - `navigate('/ads/wizard', { state: { resetAt: Date.now() } })`

### 6.7 `src/api/marketLens.js`

対応内容:

- 404 を単純な `Market Lens API error: 404` のまま出さない
- path ごとに message / code を付与
  - `market_lens_history_unavailable`
  - `market_lens_api_unavailable`

### 6.8 `src/pages/AiExplorer.jsx`

対応内容:

- `getHistory()` 失敗時の状態を明示
  - `idle`
  - `loading`
  - `ready`
  - `empty`
  - `unavailable`
  - `error`
- `history` API が停止している場合でも
  - `+ Market Lens` は `連携停止中`
  - 実際の考察生成は広告データのみで継続

意図:

- Lens AI が Market Lens 履歴停止のせいで全面停止しているように見えるのを避ける

---

## 7. ビルド結果

以下は実行済み。

- `npm run build`
  - 成功

未実施:

- コミット
- デプロイ
- 本番上での再確認
- ads 認証付きでの実 period 読み込み検証

---

## 8. 現在の git 状態

ローカル変更ファイル:

- `src/App.jsx`
- `src/api/adsInsights.js`
- `src/api/marketLens.js`
- `src/components/Layout.jsx`
- `src/contexts/AdsSetupContext.jsx`
- `src/contexts/AuthContext.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/SetupWizard.jsx`

未追跡:

- `.claude/`

---

## 9. いまの判断

### 9.1 直せる可能性が高いもの

- `Setup Wizard` の period 選択不具合
  - frontend regression の可能性が高い
  - 今回のローカル修正で改善する見込みはある
  - ただし ads 認証付きの実動確認はまだ必要

### 9.2 外部依存で止まっているもの

- `Compare`
- `Discovery`
- `CreativeReview`
- `Dashboard history`
- `AiExplorer` の Market Lens 履歴連携

理由:

- 現在設定されている `market-lens-ai.vercel.app/api/*` に旧 API surface が存在しない
- 現行公開 frontend は `marketlens-ai-backend.onrender.com/api/analyze/` を使っており、契約が別物

---

## 10. 次のチャットで最優先でやること

### A. Insight Studio 側

1. 今回のローカル差分をレビューする
2. `SetupWizard` を ads 認証付きで実動確認する
3. period が取れるなら commit / deploy する
4. Market Lens 依存画面は「接続先未確定」として切り分けたまま扱う

### B. Market Lens 側

1. 現行 backend URL を repo 内から確定する
2. 現行 public API contract を列挙する
3. 旧 `scan/discovery/review/history` が残っているか確認する
4. 残っていなければ
   - 旧互換 endpoint を戻す
   - もしくは Insight Studio 側を新契約へ移行する

---

## 11. Market Lens repo で確認すべきこと

別 repo の VS Code 上で、以下を確認すればよい。

### 11.1 まず探す文字列

- `marketlens-ai-backend.onrender.com`
- `market-lens-ai.vercel.app`
- `/api/analyze/`
- `/scan`
- `/review`
- `/history`
- `/discovery`
- `fetch(`
- `axios`
- `router`
- `FastAPI`
- `APIRouter`
- `express`
- `vercel.json`
- `render.yaml`
- `onrender`
- `VITE_`
- `NEXT_PUBLIC_`

### 11.2 特に確認すべきもの

- backend の entrypoint
- API route 定義ファイル
- frontend から参照する base URL
- deploy 時の環境変数
- 旧 API を呼んでいた箇所が残っていないか

### 11.3 欲しい最終成果物

- 現行 public backend URL
- 使える endpoint 一覧
- HTTP method
- request body 例
- response schema 例
- 認証要否
- Insight Studio から見た migration 方針

---

## 12. Market Lens repo に投げる推奨プロンプト

以下をそのまま使える。

```md
Market Lens の現行 backend 接続先と API 契約を特定してください。

前提:
- 別フロントで配信中の bundle から `https://marketlens-ai-backend.onrender.com/api/analyze/` が見つかっています。
- 旧 Insight Studio 側は以下の API を期待しています:
  - POST /scan
  - POST /discovery/analyze
  - POST /review
  - GET /history
  - GET /health
- しかし 2026-03-26 時点で `market-lens-ai.vercel.app/api/*` は 404 です。

この repo でやってほしいこと:
1. 現在 deploy されている frontend が参照している backend base URL を特定
2. backend の route 定義を調べて、現行で使える public API 一覧を列挙
3. `scan / discovery / review / history` が廃止・移動・名称変更されていないか確認
4. 旧 Insight Studio を復旧するなら
   - どの endpoint に繋ぎ替えるべきか
   - または backend 側にどの互換 endpoint を戻すべきか
   を提案
5. 根拠として、対象ファイルパスと行番号を示す

最終的にほしい出力:
- 現行 backend URL
- endpoint 一覧
- request / response 例
- 旧 API との対応表
- Insight Studio 側に必要な修正内容
```

---

## 13. Insight Studio の次チャットに投げる推奨プロンプト

```md
`plans/2026-03-26-incident-handoff.md` を読んで続きから対応してください。

優先順位:
1. ローカル変更のレビュー
2. ads 認証付きで Setup Wizard の period 選択が復旧するか検証
3. 問題なければ commit / deploy
4. Market Lens 系は handoff の外部依存整理に従って切り分け

特に以下を意識してください:
- Market Lens の旧 API surface は現在 404
- Setup Wizard は query_types の送信形式回帰が本命
- AuthContext の logout callback 不整合も併せて確認
```

---

## 14. 補足

今回の一番重要なポイントは以下。

- `Setup Wizard` は frontend regression の可能性が高いので、Insight Studio 側でまだ前進できる
- `Market Lens` は接続先そのものが変わっている可能性が高く、別 repo 側の契約確認が必要

この 2 つを混ぜると進捗が止まるため、以後も別トラックで扱うのがよい。
