# Insight Studio — Phase 3 API結線 Handoff

**作成日:** 2026-03-26
**作成者:** Claude Code (初期構築セッション)
**目的:** 新セッションで各画面の API 結線を実装するための引き継ぎ

---

## 1. 現在の状態

### 完了済み
- Vite + React + Tailwind v4 プロジェクト構築
- 全9画面の静的UI実装（Stitch 2.0 デザイン準拠）
- API クライアントモジュール（`src/api/marketLens.js`, `src/api/adsInsights.js`）
- 認証コンテキスト（`src/contexts/AuthContext.jsx`）— Gemini BYOK + 考察スタジオ認証
- APIプロキシ設定（`vite.config.js` + `vercel.json`）
- GitHub push 済み: https://github.com/kazushi-tech/insight-studio
- Vercel デプロイ済み

### 未完了（このhandoffの対象）
- 各画面に実際の API 呼び出しを結線する
- ローディング状態・エラーハンドリング
- レスポンスデータの画面表示

---

## 2. ファイル構成

```
src/
  api/
    marketLens.js      ← Market Lens API クライアント
    adsInsights.js     ← 考察スタジオ API クライアント
  contexts/
    AuthContext.jsx     ← 認証状態管理（useAuth hook）
  components/
    Layout.jsx          ← 共通レイアウト（サイドバー + ヘッダー + キー設定モーダル）
  pages/
    Dashboard.jsx       ← ダッシュボード（/ ）
    Compare.jsx         ← LP比較分析（/compare）
    Discovery.jsx       ← 競合発見（/discovery）
    CreativeReview.jsx  ← クリエイティブ診断（/creative-review）
    SetupWizard.jsx     ← 広告考察セットアップ（/ads/wizard）
    EssentialPack.jsx   ← 要点パック（/ads/pack）
    AnalysisGraphs.jsx  ← グラフ（/ads/graphs）
    AiExplorer.jsx      ← AI考察（/ads/ai）
    Settings.jsx        ← 設定（/settings）
```

---

## 3. API結線マッピング

### Market Lens AI 系（Gemini BYOK 必要）

| 画面 | ファイル | 呼ぶAPI | やること |
|------|---------|---------|---------|
| **LP比較分析** | Compare.jsx | `scan(urls, geminiKey)` | 「分析開始」ボタンで3URLを送信 → レスポンスのスコア・レポートを表示 |
| **競合発見** | Discovery.jsx | `discoveryAnalyze(url, geminiKey)` | URL入力 → 競合LP一覧をカード表示 |
| **クリエイティブ診断** | CreativeReview.jsx | `review(url, geminiKey)` | URL入力 → 4軸スコア + レポート表示 |
| **ダッシュボード** | Dashboard.jsx | `getHistory()` | 最近の分析結果テーブルに履歴データを表示 |

### 考察スタジオ系（パスワード認証必要）

| 画面 | ファイル | 呼ぶAPI | やること |
|------|---------|---------|---------|
| **セットアップウィザード** | SetupWizard.jsx | `getFolders()`, `listPeriods()`, `loadData()` | Step1: クエリ選択 → Step2: 期間選択 → Step3: データ読み込み → 結果画面へ遷移 |
| **要点パック** | EssentialPack.jsx | `generateInsights()` | データ読み込み結果からAI考察レポート生成 |
| **グラフ** | AnalysisGraphs.jsx | `loadData()` の結果 | 読み込んだデータをチャートで可視化（Chart.js or recharts 導入が必要） |
| **AI考察** | AiExplorer.jsx | `generateInsights()` | チャット形式でAI考察を対話的に生成 |
| **設定** | Settings.jsx | `getConfig()`, `saveConfig()` | BQ連携設定の読み書き |

---

## 4. useAuth hook の使い方

```jsx
import { useAuth } from '../contexts/AuthContext'

function MyPage() {
  const { geminiKey, isAdsAuthenticated, hasGeminiKey } = useAuth()

  // Market Lens API を呼ぶとき
  const result = await scan(urls, geminiKey)

  // 考察スタジオ API は認証トークンが自動付与される（adsInsights.js 内部で管理）
  const folders = await getFolders()
}
```

---

## 5. 実装の優先順位

1. **Compare.jsx** — scan API 結線（Market Lens のコア機能、動作確認が最も簡単）
2. **Discovery.jsx** — discoveryAnalyze API 結線
3. **Dashboard.jsx** — getHistory 結線（読み取り専用で安全）
4. **CreativeReview.jsx** — review API 結線
5. **SetupWizard.jsx** — 考察スタジオ BQ ウィザード結線
6. **EssentialPack.jsx** — generateInsights 結線
7. **AiExplorer.jsx** — チャット形式の考察生成
8. **AnalysisGraphs.jsx** — チャートライブラリ導入 + データ可視化
9. **Settings.jsx** — config 読み書き

---

## 6. 注意事項

- **Gemini API キーはヘッダーの鍵アイコンから設定する**（設定モーダル）
- **考察スタジオは先にログインが必要**（同モーダル内）
- Market Lens API のレスポンス形式は `market-lens-ai` リポの `web/app/models.py` を参照
- 考察スタジオ API のレスポンス形式は `ads-insights` リポの `web/app/backend_api.py` を参照
- API プロキシは dev server（vite.config.js）と本番（vercel.json）で二重設定済み
- Stitch デザインのアセットは `market-lens-ai/stitch2/` に保存（code.html + DESIGN.md + screen.png）

---

## 7. 新セッションでの最初の指示例

```
plans/phase3-api-wiring-handoff.md を読んで、
Compare.jsx の scan API 結線から始めてください。
Gemini API キーは useAuth の geminiKey を使います。
```
