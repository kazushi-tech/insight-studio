# Plan: AI考察エンジン Gemini API Key Invalid エラー対応

## Context

AI考察ページ (`/ads/ai`) で「API key not valid」エラーが発生。エラーの発信元は `generativelanguage.googleapis.com`（Gemini API）だが、フロントエンドは `provider: 'anthropic'` + Claude APIキーを正しく送信している。

**根本原因**: バックエンド (`ads-insights-9q5s.onrender.com`) の `/api/neon/generate` エンドポイントが、`provider: 'anthropic'` を受け取っているにもかかわらず Gemini API を呼び出している。Claude APIキー (`sk-ant-...`) を Gemini に渡すため当然 `API_KEY_INVALID` になる。

**フロントエンド側で確認済みの事実:**
- `AuthContext.jsx:91` — `analysisProvider` は `hasClaudeKey` が true のとき `'anthropic'` 固定
- `AiExplorer.jsx:158-159` — `model: 'claude-sonnet-4-20250514'`, `provider: 'anthropic'` を送信
- `adsInsights.js:177-190` — `neonGenerate()` は `X-API-Key` ヘッダーと `api_key` ボディの両方でキーを送信

→ フロントエンドは正しい。バックエンドが provider パラメータを無視して Gemini にフォールバックしている可能性が高い。

---

## 対応方針

バックエンドは外部サービスのため直接修正できない。フロントエンド側で以下の3層で対応する。

### Step 1: バックエンドの挙動を確認（調査）

**目的**: バックエンドが何を期待しているか確認

- ブラウザのDevToolsで `/api/ads/neon/generate` へのリクエストボディを確認
  - `provider`, `model`, `api_key` が正しく送信されているか
- バックエンドのレスポンスボディを確認
  - エラーがバックエンド自体のものか、Gemini APIからのパススルーか

### Step 2: エラーメッセージのユーザーフレンドリー化

**対象ファイル**: [AiExplorer.jsx](src/pages/AiExplorer.jsx#L191-L200)

現状、生のHTTPエラーJSON全体が表示されている。これを改善する。

```
変更内容:
- Gemini API エラー（generativelanguage.googleapis.com）を検知して専用メッセージを表示
- 「バックエンドが Gemini API を呼び出しましたが、APIキーが無効です」のような分かりやすいメッセージ
- 生のJSONではなく要約メッセージ + 折りたたみで詳細表示
```

### Step 3: neonGenerate リクエストの provider 送信を強化

**対象ファイル**: [adsInsights.js](src/api/adsInsights.js#L176-L190)

バックエンドが provider を見落とさないよう、送信方法を強化する。

```
変更内容:
- provider をヘッダー (`X-Analysis-Provider: anthropic`) にも追加
- model を明示的に必ず送信（undefined にしない）
```

### Step 4: エラーバナーの改善

**対象ファイル**: [AiExplorer.jsx](src/pages/AiExplorer.jsx)

画面上部の赤バナーに生のJSONが表示される問題を修正。

```
変更内容:
- setStatus() に渡すエラーメッセージをパースして要約
- googleapis.com 関連エラーの場合は「バックエンドのAPI設定を確認してください」と案内
- 長いエラーは truncate して詳細はチャット内に表示
```

### Step 5: バックエンド側への対応依頼（手動）

フロントエンド修正だけでは根本解決にならない場合、バックエンド側に以下を確認・依頼:

- `/api/neon/generate` が `provider` パラメータを正しく処理しているか
- `provider: 'anthropic'` のとき Gemini を呼ばないようになっているか
- バックエンドのデフォルト provider 設定が Gemini になっていないか

---

## 修正対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/pages/AiExplorer.jsx` | エラーメッセージのパース・ユーザーフレンドリー化 |
| `src/api/adsInsights.js` | neonGenerate の provider ヘッダー強化 |

## 検証方法

1. `npm run dev` で開発サーバー起動
2. AI考察ページで質問を送信
3. エラーが発生した場合、生のJSONではなく分かりやすいメッセージが表示されることを確認
4. DevTools Network タブで `provider: 'anthropic'` と `X-Analysis-Provider` ヘッダーが送信されていることを確認
5. バックエンドが修正された場合、正常にClaude経由で応答が返ることを確認
