# Insight Studio — Market Lens Recovery Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**目的:** `Compare` / `Discovery` / `Dashboard` / `AiExplorer` / `CreativeReview` の Market Lens 連携を、現行 backend 契約に合わせて復旧する  
**前提:** `Setup Wizard` の障害は別トラックで進める。この plan では扱わない

---

## 1. 背景整理

今回の追加調査で、以下が判明している。

- Insight Studio 側の現在の接続先は誤っている
  - `vercel.json`
  - `vite.config.js`
  - いずれも `https://market-lens-ai.vercel.app` を向いている
- Market Lens repo 側の現行設定は以下
  - 本番 backend: `https://market-lens-ai.onrender.com`
  - 開発 backend: `http://localhost:8002`
- Insight Studio 側 API クライアントは旧契約を前提としている
  - `GET /history`
  - `POST /review`
  - `X-Gemini-Key` header
- 現行契約では少なくとも以下へ寄せる必要がある
  - `GET /api/scans`
  - `POST /api/scan`
  - `POST /api/discovery/analyze`
  - `POST /api/reviews/{type}`
  - `api_key` は request body

重要なのは、今回の本質が「Market Lens API が消えた」ではなく、
「Insight Studio 側の接続先と request contract が古い」ことである点。

---

## 2. この plan のゴール

### P0

- `/compare` が現行 Market Lens backend に接続できる
- `/discovery` が現行 Market Lens backend に接続できる
- `/` の履歴表示が `/api/scans` ベースで復旧する
- `/ads/ai` の Market Lens 履歴連携が `/api/scans` ベースで復旧する

### P1

- `/creative-review` を現行契約で復旧する
- もし request schema が現行 UI と噛み合わない場合は、壊れた API 呼び出しを残さず、明示的な unavailable 状態へ落とす

### P2

- エラーメッセージを現行契約に合わせて整理する
- build と最低限の手動 smoke test を完了する
- commit / deploy 可能な状態まで持っていく

---

## 3. スコープ外

- `Setup Wizard` の period 復旧
- Ads API 側の認証や `list_periods` 契約確認
- Multi-BQ 対応
- Market Lens backend repo 自体の修正

これらを混ぜると切り分けが崩れるため、本 plan では扱わない。

---

## 4. まず直すべき根本原因

### 4.1 Proxy 先が古い

修正対象:

- `vercel.json`
- `vite.config.js`

やること:

- `/api/ml/:path*` の転送先を `market-lens-ai.vercel.app` から `market-lens-ai.onrender.com` に変更する
- dev proxy も同様に `https://market-lens-ai.onrender.com` へ変更する

期待効果:

- Vercel frontend 上の `/api/ml/*` が、現行 backend に届くようになる
- ローカル開発でも同じ backend 契約に揃う

### 4.2 API クライアントが旧 contract のまま

修正対象:

- `src/api/marketLens.js`

やること:

- `scan(urls, geminiKey)`
  - body を `{ urls, api_key }` に変更
- `discoveryAnalyze(url, geminiKey)`
  - body を `{ brand_url: url, api_key }` に変更
- `getHistory()`
  - `GET /history` ではなく `GET /scans` を呼ぶ
- `review(...)`
  - 単一 `/review` 呼び出しをやめる
  - `/reviews/banner`
  - `/reviews/ad-lp`
  - `/reviews/compare`
  - のどれを呼ぶか、現行 UI 仕様に基づいて分岐する
- `X-Gemini-Key` header 依存をやめる

注意:

- `CreativeReview` の request schema が確定するまで、ここだけは実装を急がない
- `review` を曖昧なまま残すと再度壊れる

---

## 5. 実装方針

## 5.1 Workstream A: Proxy と API client の現行化

対象:

- `vercel.json`
- `vite.config.js`
- `src/api/marketLens.js`

実施内容:

1. proxy 先を `market-lens-ai.onrender.com` へ変更
2. `marketLens.js` を現行 contract に合わせる
3. `request()` の error handling を見直す
   - `/history` 固定の特例をやめる
   - `/scans` / `/reviews/*` / `/discovery/analyze` / `/scan` を前提にした分類へ更新
4. レスポンス正規化 helper を `marketLens.js` 側へ寄せるか検討する

完了条件:

- 各 UI から 404 ではなく現行 backend の実レスポンスか、意味のある validation error が返る

## 5.2 Workstream B: Compare / Discovery / Dashboard / AiExplorer の追従

対象:

- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`

実施内容:

1. `Compare.jsx`
   - `report_md` fallback を追加
   - score 系の fallback を現行レスポンスに合わせて補強
2. `Discovery.jsx`
   - request は API client 側で `brand_url` 化
   - response は `competitors` を主軸にしつつ fallback を残す
   - 必要なら `analysis.report_md` の表示枠を追加
3. `Dashboard.jsx`
   - `data.scans ?? data.history ?? data.results ?? array` で履歴を吸収
4. `AiExplorer.jsx`
   - `data.scans ?? data.history ?? data.results ?? array` で履歴を吸収
   - `market_lens_history_unavailable` 判定条件を `/scans` ベースへ更新

完了条件:

- `Compare`
- `Discovery`
- `Dashboard`
- `AiExplorer`

の 4 画面が、旧 endpoint 前提を持たない状態になる

## 5.3 Workstream C: CreativeReview の契約監査と分岐

対象:

- `src/pages/CreativeReview.jsx`
- 必要なら `src/api/marketLens.js`

前提:

- 現行 backend では review endpoint が 3 分化している
- 例として共有された request は `asset_id` ベースで、現行 UI の `url` 入力と一致していない

先にやるべきこと:

1. Market Lens repo で以下を再確認
   - `/api/reviews/banner`
   - `/api/reviews/ad-lp`
   - `/api/reviews/compare`
2. それぞれの request schema をファイルと行番号付きで確定
3. 現行 UI がどの endpoint に対応すべきか判断

分岐:

- もし `url` だけで診断できる契約がある
  - UI を最小修正で現行 endpoint に接続する
- もし `asset_id` 等の前処理が必須
  - この画面は即復旧対象から外す
  - 壊れた API call をやめ、`現在の Market Lens backend 契約では未対応` の明示状態へ変更する

重要:

- `CreativeReview` は他 4 画面の復旧を止める blocker にしない

## 5.4 Workstream D: 検証とリリース判断

対象:

- local build
- route ごとの smoke test
- deploy 後の簡易確認

実施内容:

1. `npm run build`
2. 手動確認
   - `/compare`
   - `/discovery`
   - `/`
   - `/ads/ai`
   - `/creative-review`
3. エラー時は endpoint mismatch か backend 起因かを分離して記録
4. commit message は Market Lens 復旧とわかるものにする

---

## 6. Agent Team で進める場合の分担

作業量は中規模以上なので、Claude 側で sub-agent / task agent が使えるなら分担した方が速い。

### Lead / Integrator

責務:

- 全体の優先順位管理
- agent 間の write scope 調整
- 最終レビュー
- commit / deploy 判断

担当ファイル:

- 最終統合のみ

### Agent 1: Contract Explorer

責務:

- Market Lens repo から現行 endpoint 契約を再確認する
- 特に `CreativeReview` で使うべき endpoint を確定する

成果物:

- endpoint 一覧
- request / response schema
- 根拠ファイルと行番号
- `CreativeReview` 実装可否の結論

担当範囲:

- 読み取り専用

### Agent 2: Proxy + Client Worker

責務:

- 接続先の修正
- `src/api/marketLens.js` の現行化

担当ファイル:

- `vercel.json`
- `vite.config.js`
- `src/api/marketLens.js`

### Agent 3: Consumer UI Worker

責務:

- `Compare`
- `Discovery`
- `Dashboard`
- `AiExplorer`

のレスポンス追従とエラー状態整理

担当ファイル:

- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`

### Agent 4: Creative Review Worker

責務:

- Agent 1 の結論を受けて `CreativeReview` を実装、または unavailable 状態へ落とす

担当ファイル:

- `src/pages/CreativeReview.jsx`
- 必要なら `src/api/marketLens.js` の review 分岐部分

### Agent 5: QA / Release Worker

責務:

- build 実行
- route 別 smoke test
- 結果の記録

担当範囲:

- 読み取り中心
- 必要最小限の修正のみ

---

## 7. Skill を使う場合の推奨

Claude 環境で skill が使えるなら、以下に相当する skill を優先する。

### 1. Repo Search / Contract Audit

用途:

- Market Lens repo で route 定義を正確に拾う
- request / response schema を取り違えない

対象:

- `scan`
- `scans`
- `discovery/analyze`
- `reviews/banner`
- `reviews/ad-lp`
- `reviews/compare`

### 2. Frontend Integration

用途:

- API client と UI consumer をずらさず修正する
- response fallback を整理する

### 3. Release Verification

用途:

- build
- smoke test
- deploy 後確認

### 4. Error Handling / UX Guardrail

用途:

- `CreativeReview` のように契約未確定の画面を壊れたまま残さない
- unavailable / maintenance 表示へ安全に落とす

skill 名が一致しない環境でも、上記役割に相当するものを優先すればよい。

---

## 8. 実装順

1. Agent 1 が `CreativeReview` 契約だけ先に確定する
2. それを待たず、Agent 2 は proxy と `marketLens.js` を進める
3. 並行して Agent 3 が `Compare` / `Discovery` / `Dashboard` / `AiExplorer` を修正する
4. Agent 4 は Agent 1 の結論後に `CreativeReview` を処理する
5. Lead が統合レビュー
6. Agent 5 が build と smoke test
7. 問題なければ commit / deploy

この順にする理由:

- `CreativeReview` だけ contract 不確実性が高い
- 他 4 画面は今の情報だけで前進しやすい

---

## 9. 変更対象ファイル

- `vercel.json`
- `vite.config.js`
- `src/api/marketLens.js`
- `src/pages/Compare.jsx`
- `src/pages/Discovery.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/CreativeReview.jsx`

---

## 10. 受け入れ条件

### 必須

- `/api/ml/*` が `market-lens-ai.onrender.com` 前提で動く
- `Compare` が旧 `/review` や `/history` 前提を持たない
- `Discovery` が `brand_url` + `api_key` 契約で呼べる
- `Dashboard` が `/api/scans` ベースで履歴表示できる
- `AiExplorer` が `/api/scans` ベースで履歴要約を作れる
- `npm run build` が通る

### 条件付き

- `CreativeReview` は以下のどちらかなら可
  - 現行 endpoint に接続して正常動作
  - 契約未対応として明示的に unavailable 表示

### 不可

- 旧 `market-lens-ai.vercel.app/api/*` 前提を残す
- `X-Gemini-Key` header 依存を残す
- `CreativeReview` を根拠不明の endpoint へ決め打ちする

---

## 11. Claude にそのまま渡す指示文

```md
`plans/2026-03-26-market-lens-recovery-plan.md` を読んで、その plan に従って Market Lens 復旧を進めてください。

優先順位:
1. Proxy 先の修正
2. `src/api/marketLens.js` の現行 contract 追従
3. `Compare` / `Discovery` / `Dashboard` / `AiExplorer` の復旧
4. `CreativeReview` は別トラックで contract を確認し、実装できないなら unavailable 状態へ落とす
5. build と smoke test

可能なら agent team で分担してください。
特に以下の役割に分けてください:
- contract explorer
- proxy/client worker
- consumer UI worker
- creative review worker
- QA/release worker

skill が使える環境なら、repo search / contract audit / frontend integration / release verification 系を優先してください。

注意:
- Setup Wizard はこの plan のスコープ外です
- `market-lens-ai.vercel.app` ではなく `market-lens-ai.onrender.com` を正とします
- `X-Gemini-Key` header 前提はやめ、`api_key` を request body に入れてください
- 旧 `/history` と `/review` をそのまま残さないでください
```

