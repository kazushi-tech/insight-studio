# 全分析機能の応答時間短縮計画

## Context

LP比較分析・競合発見・クリエイティブレビュー・AI考察の全API分析機能で体感待ち時間が長い。
モデル変更なし（Claude維持）の制約下で、フロントエンド側の最適化のみで改善を狙う。

---

## 修正一覧

### 1. Ads レポート生成の並列化（最大効果: 15-30s短縮）

**ファイル:** `src/utils/adsReports.js` L236-253

**現状:** `regenerateAdsReportBundle()` が複数期間を `for...await` で逐次実行。
3期間あれば 3× 待ち時間。

**修正:** `Promise.all()` で並列化。

```js
// Before
const results = []
for (const period of setupState.periods) {
  const result = await generateBatchWithRetry({ ... })
  results.push(result)
}

// After
const results = await Promise.all(
  setupState.periods.map(period =>
    generateBatchWithRetry({
      query_types: setupState.queryTypes,
      dataset_id: setupState.datasetId,
      period,
    })
  )
)
```

---

### 2. Discovery ポーリングの適応的バックオフ（体感改善: 5-10s）

**ファイル:** `src/pages/Discovery.jsx` L9, L247-261

**現状:** 固定3秒間隔。サーバーの `retry_after_sec` は使っているが、
それがない場合は常に3秒。初期段階（queued/brand_fetch）は処理が長いので無駄打ちが多い。

**修正:** 経過時間に応じてポーリング間隔を段階的に広げる。

```js
// 新定数
const POLL_INTERVAL_INITIAL_MS = 2000   // 最初は2秒（完了検知を早く）
const POLL_INTERVAL_SLOW_MS = 5000      // 30秒経過後は5秒間隔
const POLL_SLOWDOWN_AFTER_MS = 30000    // 30秒でスローダウン

// tick内のスケジュール部分（L247-251）
const elapsed = Date.now() - pollStartTimeRef.current
const baseInterval = elapsed > POLL_SLOWDOWN_AFTER_MS
  ? POLL_INTERVAL_SLOW_MS
  : POLL_INTERVAL_INITIAL_MS
const nextPollIntervalMs = Number(data.retry_after_sec) > 0
  ? Number(data.retry_after_sec) * 1000
  : baseInterval
```

---

### 3. Discovery / Creative Review のリトライ回数増加（失敗時の再実行短縮）

**ファイル:** `src/api/marketLens.js` L22-23, L266-267

**現状:**
- `DISCOVERY_AUTO_RETRY_COUNT = 1`, 固定2.5秒ディレイ
- `REVIEW_AUTO_RETRY_COUNT = 1`, 固定2秒ディレイ

**修正:** リトライ2回に増加 + 段階的バックオフ。

```js
// Discovery
const DISCOVERY_AUTO_RETRY_COUNT = 2
const DISCOVERY_AUTO_RETRY_DELAYS_MS = [1500, 4000]

// Creative Review
const REVIEW_AUTO_RETRY_COUNT = 2
const REVIEW_AUTO_RETRY_DELAYS_MS = [1500, 4000]
```

対応するリトライループも `DELAYS_MS[attempt]` 参照に変更。

---

### 4. AI考察のコンテキスト圧縮（API応答速度: 20-40%改善）

**ファイル:** `src/pages/AiExplorer.jsx` L202-218

**現状:** 毎回 `point_pack_md`（フルレポートMarkdown, 5-15KB）と
`ai_chart_context`（全チャートデータ）を送信。会話が進むほどトークン膨張。

**修正:** 
- `point_pack_md` は初回メッセージのみフル送信、2回目以降は `extractMarkdownSummary()` で要約版を送信
- `conversation_history` のスライスを10→6に縮小

```js
const isFirstMessage = messages.length === 0
const packContext = isFirstMessage
  ? reportBundle.reportMd
  : extractMarkdownSummary(reportBundle.reportMd) || reportBundle.reportMd

// conversation_history も6件に
conversation_history: toConversationHistory(nextMessages),
```

`toConversationHistory` のスライスも `.slice(-6)` に変更（`src/pages/AiExplorer.jsx` L54）。

---

### 5. セッションストレージ書き込みのデバウンス（UIジャンク防止）

**ファイル:** `src/pages/AiExplorer.jsx` L102-104

**現状:** メッセージ変更のたびに同期的にsessionStorage書き込み。

**修正:** 500msデバウンスを追加。

```js
const draftTimerRef = useRef(null)
useEffect(() => {
  clearTimeout(draftTimerRef.current)
  draftTimerRef.current = setTimeout(() => {
    setDraft('ai-explorer', { messages: messages.slice(-50), contextMode })
  }, 500)
  return () => clearTimeout(draftTimerRef.current)
}, [messages, contextMode, setDraft])
```

---

## 対象ファイル一覧

| ファイル | 修正内容 |
|----------|----------|
| `src/utils/adsReports.js` | 期間並列化 |
| `src/pages/Discovery.jsx` | ポーリング適応バックオフ |
| `src/api/marketLens.js` | リトライ回数増加+バックオフ |
| `src/pages/AiExplorer.jsx` | コンテキスト圧縮+デバウンス |

## 実装順序

1. **修正1** (adsReports.js) — 最大効果、変更箇所1関数
2. **修正3** (marketLens.js) — 定数変更+ループ微修正
3. **修正2** (Discovery.jsx) — ポーリング定数+ロジック
4. **修正4** (AiExplorer.jsx) — コンテキスト圧縮
5. **修正5** (AiExplorer.jsx) — デバウンス

## 検証計画

1. `npm run build` でビルド成功確認
2. **修正1検証:** Ads AI セットアップで複数期間選択 → レポート生成時間を計測（Network tab）
3. **修正2検証:** Discovery実行 → Network tabでポーリング間隔が2s→5sに変化することを確認
4. **修正3検証:** バックエンドを一時停止してリトライが2回走ることをNetwork tabで確認
5. **修正4検証:** AI考察で3往復会話 → リクエストbodyサイズが初回より縮小していることを確認
6. **修正5検証:** メッセージ連投 → sessionStorage書き込みが集約されていることを確認
