# Fix: バックエンド応答速度の根本改善

## Context

Render 無料プランの両バックエンドは非アクティブ時にスリープする。ユーザーが操作を始めてからコールドスタートが発生するため、全機能で初回リクエストが遅い・タイムアウトする。タイムアウトを延ばすのではなく **待ち時間そのものをなくす**。

## 問題の全体像

| 機能 | API | 問題 |
|------|-----|------|
| クリエイティブ診断（アップロード） | Market Lens | Vercel プロキシ経由 → 60秒で死ぬ。`direct` 未対応 |
| 競合発見 / LP比較分析 | Market Lens | `direct: true` 済みだがコールドスタート分が待ち時間に |
| AI考察 (`neonGenerate`) | Ads Insights | `timeout: 120000` だが Vercel プロキシ経由 → 60秒で死ぬ |

**共通の根本原因:** バックエンドが寝ている + 起こすのがリクエスト時

## 修正方針：3段構え

### Step 1: Layout マウント時に両バックエンドを pre-warm

- **ファイル:** `src/components/Layout.jsx`
- Layout マウント時に両バックエンドの `/health` を fire-and-forget で叩く
- ユーザーがページを見始めた瞬間にバックグラウンドで起動 → 体感待ち時間ほぼゼロ

### Step 2: アップロードの Vercel プロキシ迂回

- **ファイル:** `src/api/marketLens.js`
- `requestRaw()` (L448) に `direct` オプション追加（`requestJson()` L386-394 と同じパターン）
- `uploadCreativeAsset()` (L592) → `direct: true`, `timeout: 30000`

### Step 3: AI考察の Vercel プロキシ迂回

- **ファイル:** `src/api/adsInsights.js`
- `request()` (L56) に `direct` オプション追加
- `ADS_DIRECT_BASE = 'https://ads-insights-9q5s.onrender.com/api'` 定数追加
- `neonGenerate()` (L175) → `direct: true`（Vercel 60秒制限を回避）

## 実行ワークフロー

### Phase 1: `/agent-team-workflow` で3ファイル並列修正

| Agent | 担当ファイル | 作業内容 |
|-------|-------------|----------|
| Agent A | `src/components/Layout.jsx` | `useEffect` で両バックエンド `/health` を fire-and-forget ping |
| Agent B | `src/api/marketLens.js` | `requestRaw` に direct 対応 + `uploadCreativeAsset` に direct/timeout |
| Agent C | `src/api/adsInsights.js` | `request` に direct 対応 + `neonGenerate` に direct: true |

### Phase 2: `/codex-review` で品質ゲート

- 3 Agent の差分を統合レビュー
- CSP ヘッダーとの整合性確認（`vercel.json` の `connect-src` に両ドメイン登録済みか）
- Critical / Major が 0 になるまで修正ループ

### Phase 3: `/ads-deploy` でデプロイ＋検証

- Vercel デプロイ
- コールドスタート状態で各機能を実行して確認

## 検証チェックリスト

- [ ] `npm run build` 成功
- [ ] Creative Review: バナーアップロードが30秒以内に完了
- [ ] 競合発見: コールドスタート込みでも分析開始が速い
- [ ] AI考察: 60秒超でもタイムアウトしない
- [ ] CSP エラーがブラウザコンソールに出ない
