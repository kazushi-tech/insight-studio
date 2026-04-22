# AI考察画面 レポート履歴ドロワー実装プラン

作成日: 2026-04-21
対象画面: `/ads/ai`（AIエクスプローラー）
実装者: 別セッションのClaude向け

---

## 1. Context（なぜこの変更か）

### ユーザー観察（screenshot ベースの現況評価）

現在の AI考察画面は以下の構造で描画されている:

- **ヘッダー**: 「考察生成完了」ステータス、CONTEXT（広告データのみ / +Market Lens）、SIZE（小/中/大）、「チャット消去」「コンテキスト更新」ボタン
- **AI考察エンジン / 昨日の結果を教えて** プロンプトエリア
- **考察サマリー**: TL;DR 3点 + 数値メトリクスカード（セッション数・PV数・平均エンゲージメント時間・エンゲージドユーザー数）
- **推奨グラフチップ**: 日別セッション推移 / 日別エンゲージメント推移 / 日別LP流入セッション推移
- **TL;DR** セクション
- **4月19日の結果サマリー** 表形式の指標比較
- **アクセス量の評価**、**注目点：エンゲージメント時間の良化**、**課題・懸念点**、**次アクション案（P0/P1/P2）**
- **関連データグラフを展開(3)**: PV分析・異常検知・デバイス分析の折れ線／棒グラフ

### UI/UX 評価（現状）

**良い点**:
- 情報階層が論理的（TL;DR → 定量サマリー → 定性評価 → アクション）
- P0/P1/P2 優先度付けで行動喚起が明確
- 関連グラフが考察と同画面で確認できる
- カードベースのトーナルレイヤリング、Botanical Green の落ち着いた色調で長文でも疲れにくい

**改善余地（本プランの対象外、別セッションで検討）**:
- 見出しごとの絵文字が揃っておらず、アイコンとの競合でノイズに見える
- 「4月19日」「直帰率100%」のような重要数値にハイライトがなく、本文に埋もれがち
- 関連データグラフ3枚が横並びで情報密度が高いため、縦スクロール中の視認性が下がる
- モバイル対応不要だが、ワイド画面での余白活用が甘い（中央に寄せすぎ）

### 分析品質評価（現状）

**高評価**:
- 「直帰率100% は GA4 のセッション定義起因」という技術的洞察を明示
- 「週末は訪問者の質が高い」という逆説的洞察に数値根拠（17.3秒 vs 12.7秒）を添えている
- 次アクションに `engagement_time_msec` のような具体的パラメータ名を提示

**改善余地（本プランの対象外）**:
- 統計的有意性の議論がなく、サンプル数61件での結論の信頼区間が不明
- 「週末パターンと一致」の根拠となる前週比較データが本文に埋もれている
- P0/P1/P2 の期限・工数見積が無く、実行計画として弱い

### 本プランの核心要望（確定済み）

1. **レポート単位で履歴化**: セットアップ完了〜次のセットアップまでのチャット全体を1レポートとして保存
2. **自動履歴化**: 再セットアップ完了時に前セッションを自動 push（「チャット消去」ボタンを押す手間を無くす）
3. **API コスト削減**: 履歴からの復元は完全にローカル処理、Claude API を叩かない
4. **右スライドドロワー**: ヘッダー `key` アイコンの左に `history` アイコンを追加、クリックで右から開く
5. **localStorage 保存**: 案件（case_id）別スコープ、Market Lens 既存実装（`insight-studio-market-lens-scan-history:*`）と同じ方針

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Layout.jsx (header)                                    │
│   ┌─ CaseSelector ─┐      ┌─ history ┐ ┌─ key ┐ ...     │
│   └────────────────┘      └───┬──────┘ └──────┘         │
└────────────────────────────────┼────────────────────────┘
                                 │ toggle
                                 ▼
                  ┌──────────────────────────────┐
                  │  ReportHistoryDrawer (新規)  │
                  │  slide-in from right         │
                  │  list / preview / restore    │
                  └─────────────┬────────────────┘
                                │ read/write
                                ▼
                  ┌──────────────────────────────┐
                  │  ReportHistoryContext (新規) │
                  │   addEntry / removeEntry     │
                  │   restoreEntry / clearAll    │
                  └─────────────┬────────────────┘
                                │ backed by
                                ▼
                  ┌──────────────────────────────┐
                  │  localStorage                │
                  │  key: insight-studio-ads-    │
                  │  report-history:{caseId}     │
                  └──────────────────────────────┘

     ┌─────────────────┐
     │ completeSetup() │  [AdsSetupContext.jsx:232]
     └────────┬────────┘
              │ 新規 hook
              ▼
      前回の messages（sessionStorage）+ reportBundle +
      setupState が非空なら addEntry、その後 sessionStorage.clear
```

### キーデザイン原則

- **責務分離**: 履歴 I/O は `AdsSetupContext` から切り離し、新規 `ReportHistoryContext` に集約
- **Context 循環依存の回避**: 履歴化は `AdsSetupContext.completeSetup` 内で localStorage ユーティリティを直接呼び、`window.dispatchEvent('report-history-updated')` で `ReportHistoryContext` に再読込を通知
- **復元は純粋 state 置換**: `messages` と `reportBundle` を履歴エントリで上書き、API は叩かない
- **源フラグ**: 復元した `reportBundle.source = 'restored_from_history'` にし、`AiExplorer.jsx:141` の自動再生成ガードに OR 条件追加

---

## 3. Data Model

### 3-1. エントリスキーマ

```js
// ReportHistoryEntry (v1)
{
  version: 1,
  id: string,                          // crypto.randomUUID()
  caseId: string,                      // 'petabit' など
  createdAt: string,                   // ISO-8601（履歴化した瞬間）

  setupState: {
    queryTypes: string[],
    periods: string[],
    granularity: 'monthly'|'weekly'|'daily',
    datasetId: string,
    completedAt: string,
  },

  reportBundle: {
    reportMd: string,
    chartGroups: Array,
    generatedAt: string,
    source: string,                    // 'bq_generate_batch' 等
  },

  messages: Array<{ role, text, isError?, timestamp? }>,
  contextMode: 'ads-only' | 'ads-with-ml',

  metadata: {
    title: string,
    tldr: string,                      // reportMd 先頭 120 文字
    messageCount: number,
    periodsLabel: string,
    queryTypesLabel: string,
  },
}
```

### 3-2. localStorage キー

| 種別 | キー | 参考 |
|---|---|---|
| 履歴本体 | `insight-studio-ads-report-history:{caseId}` | [AdsSetupContext.jsx:20-22](src/contexts/AdsSetupContext.jsx#L20-L22) |

- 案件未選択 (`currentCase=null`) のとき保存スキップ

### 3-3. 容量ポリシー

- 上限 **20件**、FIFO で古いものから削除
- `QuotaExceededError` 時の3段階フォールバック:
  1. 最古5件 drop → retry
  2. 全エントリの `chartGroups` を空にして 10 件制限で保存
  3. 失敗時は `console.warn` で握りつぶす（トースト不要）

---

## 4. 履歴化トリガー

### 4-1. トリガーポイント

[AdsSetupContext.jsx:232-248](src/contexts/AdsSetupContext.jsx#L232-L248) の `completeSetup` 内部。SetupWizard の完了を必ず通る。

### 4-2. 判定フロー

```
completeSetup(payload, nextReportBundle) 呼び出し
│
├─ 初回（prev setupState が null）？ → スキップ
├─ sessionStorage 'is-draft-ai-explorer' から messages 取得 → 空なら スキップ
├─ hasSetupChanged(prev, next)：
│   periods / datasetId / queryTypes のいずれか変更？
│   granularity だけの変更はスキップ（ノイズ削減）
│   → すべて同じなら スキップ
└─ すべてクリア → addEntry（前 setupState + 前 reportBundle + 前 messages）
    その後 sessionStorage.removeItem('is-draft-ai-explorer')
```

### 4-3. 実装スケッチ（AdsSetupContext.completeSetup 修正版）

```js
const completeSetup = useCallback((payload, nextReportBundle = null) => {
  // ★ 前セッションを履歴化
  if (setupState && reportBundle?.reportMd) {
    if (hasSetupChanged(setupState, payload)) {
      try {
        const draftRaw = sessionStorage.getItem('is-draft-ai-explorer')
        const draft = draftRaw ? JSON.parse(draftRaw) : null
        const prevMessages = Array.isArray(draft?.messages) ? draft.messages : []
        if (prevMessages.length > 0) {
          const history = loadHistory(currentCase?.case_id)
          const entry = buildEntry({
            caseId: currentCase?.case_id,
            setupState,
            reportBundle,
            messages: prevMessages,
            contextMode: draft?.contextMode ?? 'ads-only',
          })
          saveHistory(currentCase?.case_id, [entry, ...history])
          sessionStorage.removeItem('is-draft-ai-explorer')
          window.dispatchEvent(new Event('report-history-updated'))
        }
      } catch (e) { console.warn('[ReportHistory] push failed:', e) }
    }
  }
  // ...既存処理...
}, [setupState, reportBundle, currentCase?.case_id, getCurrentDatasetId])
```

`hasSetupChanged`:
```js
function hasSetupChanged(prev, next) {
  if (prev.datasetId !== next.datasetId) return true
  if (arraysDiffer(prev.periods, next.periods)) return true
  if (arraysDiffer(prev.queryTypes, next.queryTypes)) return true
  return false  // granularity だけの変更は無視
}
```

---

## 5. UI 設計（ReportHistoryDrawer）

### 5-1. 全体構造

```jsx
<aside className="fixed top-0 right-0 h-full z-[100] w-[460px] max-w-full
                  transform transition-transform duration-200
                  [open ? translate-x-0 : translate-x-full]">
  <div className="bg-surface-container-lowest shadow-2xl h-full flex flex-col">
    {/* Header */}
    {/* List or EmptyState */}
    {/* Footer (optional clearAll) */}
  </div>
</aside>
<div onClick={close} className="fixed inset-0 z-[99] bg-black/20" />
```

- 幅 `w-[460px]` / `max-w-full`
- アニメーション: `translate-x-full → translate-x-0` + `transition-transform duration-200`
- オーバーレイクリック / Esc で閉じる
- フォーカストラップは [Layout.jsx:144-177](src/components/Layout.jsx#L144-L177) の KeySettingsModal 実装を踏襲

### 5-2. Header

```
┌───────────────────────────────────────┐
│ レポート履歴 [2/20]               ×   │
└───────────────────────────────────────┘
```
- `h3` タイトル + 件数バッジ + ×ボタン（`material-symbols-outlined close`）

### 5-3. リスト項目

```
┌──────────────────────────────────────┐
│ 2026-04-15 14:32            [削除]   │
│ 2024-10, 2024-11 / search, landing  │
│ ≫ LP訪問から離脱するユーザーが…      │
│ 💬 8 メッセージ                      │
│ [プレビュー]  [このレポートを復元]    │
└──────────────────────────────────────┘
```

- カードスタイル: `rounded-xl bg-surface-container-low hover:bg-surface-container p-4`
- `metadata.tldr` は `line-clamp-2`
- プレビュー: `MarkdownRenderer` で `reportMd` 先頭 ~400 文字表示
- 復元: 確認ダイアログ後に `restoreEntry(id)` 発火

### 5-4. 空状態

```
     📜
  まだ履歴がありません
  セットアップを再実行すると、
  前回のレポートが自動保存されます
```

### 5-5. ダークモード / v1-v2 互換

- `--color-surface-*` トークン使用で自動対応
- ドロワー自体は UI バージョン非依存。復元後の描画は既存の v1/v2 分岐（[AiExplorer.jsx:451](src/pages/AiExplorer.jsx#L451)）に乗る

---

## 6. ヘッダーアイコン追加

### 6-1. 配置

[Layout.jsx:571-583](src/components/Layout.jsx#L571-L583) の APIキーボタンの **左** に `history` アイコンボタンを追加。

並び: `[history] [key] [menu_book] [light/dark_mode] | [user]`

key の attention ドットと視覚的に衝突しない位置。

### 6-2. 表示条件

**結論: 全画面で常時表示**。ただし `/ads/ai` 以外でクリックした場合は `navigate('/ads/ai')` してからドロワーを開く（復元コンテキスト整合のため）。

### 6-3. 実装スケッチ

```jsx
<button
  onClick={() => {
    if (location.pathname !== '/ads/ai') navigate('/ads/ai')
    setShowHistoryDrawer(true)
  }}
  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
  title="レポート履歴"
  aria-label="レポート履歴を開く"
>
  <span className="material-symbols-outlined">history</span>
</button>
```

---

## 7. 状態管理レイヤー

### 7-1. ReportHistoryContext（新規）

**パス**: `src/contexts/ReportHistoryContext.jsx`

```jsx
export function ReportHistoryProvider({ children }) {
  const { currentCase } = useAdsSetup()
  const [history, setHistory] = useState(() => loadHistory(currentCase?.case_id))
  const [restoreTarget, setRestoreTarget] = useState(null)

  // case 切替時リロード
  useEffect(() => {
    setHistory(loadHistory(currentCase?.case_id))
  }, [currentCase?.case_id])

  // completeSetup 経由の addEntry をリッスン
  useEffect(() => {
    const onUpdate = () => setHistory(loadHistory(currentCase?.case_id))
    window.addEventListener('report-history-updated', onUpdate)
    return () => window.removeEventListener('report-history-updated', onUpdate)
  }, [currentCase?.case_id])

  const addEntry = useCallback((entryData) => { /* buildEntry + saveHistory + setHistory */ }, [...])
  const removeEntry = useCallback((id) => { /* filter + saveHistory + setHistory */ }, [...])
  const restoreEntry = useCallback((id) => {
    const entry = history.find(h => h.id === id)
    if (!entry) return null
    setRestoreTarget({ entry, at: Date.now() })
    return entry
  }, [history])
  const clearAll = useCallback(() => { /* saveHistory([]) + setHistory([]) */ }, [...])

  return <ReportHistoryContext.Provider value={{
    history, addEntry, removeEntry, restoreEntry, clearAll,
    restoreTarget, clearRestoreTarget: () => setRestoreTarget(null),
  }}>{children}</ReportHistoryContext.Provider>
}
```

### 7-2. Storage ユーティリティ

**パス**: `src/utils/reportHistoryStorage.js`

主要関数:
- `loadHistory(caseId)` — JSON parse + `version===1` でフィルタ + `createdAt` 降順ソート
- `saveHistory(caseId, history)` — 20件上限 + 3段階フォールバック
- `buildEntry({caseId, setupState, reportBundle, messages, contextMode})` — metadata 生成含む
- `buildEntryMetadata(setupState, reportBundle, messages)` — tldr は `extractMarkdownSummary`（[adsReports.js](src/utils/adsReports.js) の既存関数）で抽出

### 7-3. AiExplorer 側の復元ハンドラ

[AiExplorer.jsx](src/pages/AiExplorer.jsx) に追加:

```jsx
const { restoreTarget, clearRestoreTarget, addEntry } = useReportHistory()
const { setReportBundle } = useAdsSetup()

useEffect(() => {
  if (!restoreTarget?.entry) return
  const entry = restoreTarget.entry

  // 現セッションに未保存履歴があれば先に push
  if (messages.length > 0 && reportBundle?.reportMd) {
    addEntry({ setupState, reportBundle, messages, contextMode })
  }

  // 復元（API は叩かない）
  setMessages(entry.messages.map(m => ({ ...m, restoredFromHistory: true })))
  setContextMode(entry.contextMode ?? 'ads-only')
  setReportBundle({ ...entry.reportBundle, source: 'restored_from_history' })
  clearDraft('ai-explorer')
  setDraft('ai-explorer', { messages: entry.messages, contextMode: entry.contextMode })

  setStatus('✓ 履歴から復元しました（API 未使用）')
  clearRestoreTarget()
}, [restoreTarget])
```

### 7-4. Provider 配置

`src/main.jsx` で `<AdsSetupProvider>` の **内側** に `<ReportHistoryProvider>` を追加（`useAdsSetup()` 依存のため）。

---

## 8. API 呼び出し削減（核心要件）

### 8-1. 復元フロー（API ゼロ）

1. ドロワーで「復元」クリック
2. `restoreEntry(id)` → `restoreTarget` state 更新
3. `AiExplorer` useEffect 発火 → `setMessages` + `setReportBundle`
4. v2 なら `InsightTimeline` が messages 描画、`MarkdownRenderer` は純粋関数で API 不要
5. `InsightChartPanel` の `chartGroups` 描画も既存のローカル処理のみ

### 8-2. 自動再生成の抑止

[AiExplorer.jsx:139-167](src/pages/AiExplorer.jsx#L139-L167) の `regenerateAdsReportBundle` 再生成 useEffect が復元時に発火すると API を叩く。

**対策**:
- 復元時に `reportBundle.source = 'restored_from_history'` をセット
- L141 のガード条件を `reportBundle?.source === 'bq_generate_batch' || reportBundle?.source === 'restored_from_history'` に拡張

### 8-3. 復元後の新規質問

- `handleSend()` は通常動作（API を叩く、仕様通り）
- status に `✓ 履歴から復元しました（API 未使用）` 表示
- 各メッセージに `restoredFromHistory: true` フラグ付与（UI バッジは Phase 2 で任意追加）

---

## 9. Implementation Plan（ファイル別）

### 9-1. 新規ファイル

| ファイル | 行数目安 | 役割 |
|---|---|---|
| `src/contexts/ReportHistoryContext.jsx` | 120-150 | Context 本体、useReportHistory フック |
| `src/utils/reportHistoryStorage.js` | 100-130 | load/save/buildEntry ユーティリティ |
| `src/components/report-history/ReportHistoryDrawer.jsx` | 180-250 | ドロワー本体 |
| `src/components/report-history/ReportHistoryItem.jsx` | 80-110 | リスト項目 |
| `src/components/report-history/ReportHistoryPreview.jsx` | 40-60 | プレビュー展開 |
| `src/components/report-history/__tests__/ReportHistoryDrawer.test.jsx` | 150 | RTL テスト |
| `src/utils/__tests__/reportHistoryStorage.test.js` | 120 | storage ユニットテスト |

### 9-2. 既存ファイル変更

| ファイル | 変更概要 | 参考行 |
|---|---|---|
| [src/contexts/AdsSetupContext.jsx](src/contexts/AdsSetupContext.jsx) | `completeSetup` 冒頭に「前セッション履歴化」ブロック追加 | L232-248 |
| [src/main.jsx](src/main.jsx) | `<ReportHistoryProvider>` を `<AdsSetupProvider>` の内側に追加 | — |
| [src/components/Layout.jsx](src/components/Layout.jsx) | (a) `useState showHistoryDrawer` (b) header `history` ボタン追加 (c) `<ReportHistoryDrawer />` 配置 | L336, L571, L628 |
| [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) | (a) `useReportHistory` import (b) `restoreTarget` subscribe useEffect (c) L141 ガード条件に `'restored_from_history'` 追加 | L81, L139-167, L475 |

### 9-3. 実装順序

1. **Storage 層**: `reportHistoryStorage.js` + ユニットテスト
2. **Context 層**: `ReportHistoryContext.jsx` + `main.jsx` 登録
3. **履歴化トリガー**: `AdsSetupContext.completeSetup` 修正
4. **Drawer UI**: 3コンポーネント
5. **Header 統合**: `Layout.jsx` にアイコンボタン追加
6. **Restore フロー**: `AiExplorer.jsx` に subscribe useEffect + ガード条件拡張
7. **テスト**: RTL + webapp-testing smoke

---

## 10. Edge Cases & Tradeoffs

### 10-1. Edge Cases

| Case | 対応 |
|---|---|
| localStorage quota 超過 | `saveHistory` の3段階フォールバック |
| 案件切替 | `currentCase.case_id` 変化で `ReportHistoryContext` が履歴再読込 |
| ゲストモード / case_id 無し | 保存スキップ |
| v1/v2 UI 切替 | エントリは UI 非依存、復元後に既存分岐で描画 |
| GuideModal 等との z-index 競合 | `z-[100]` で統一、開いた状態で key ボタン押したら Drawer を閉じる（任意） |
| ダークモード | `--color-surface-*` トークンで自動対応 |
| 復元中の自動再生成 | `source: 'restored_from_history'` フラグ + L141 ガード拡張で抑止 |
| sessionStorage draft | 復元時に `setDraft` で上書き、タブ再読込後も再現 |

### 10-2. Tradeoffs

| 選択 | 採用 | 却下理由 |
|---|---|---|
| 新規 Context | ○ | AdsSetupContext 肥大化防止 |
| `completeSetup` 内で履歴化 | ○ | 手動ボタン不要の要望に合致 |
| 変更判定（periods/datasetId/queryTypes） | ○ | granularity だけの変更でノイズ蓄積を防ぐ |
| 上限 20 件 | ○ | localStorage 4-5MB 制限、1エントリ 200KB 想定 |
| アイコン位置: key の左 | ○ | attention ドットと衝突しない |

---

## 11. Verification Plan

### 11-1. Unit Tests

**`src/utils/__tests__/reportHistoryStorage.test.js`**:
- [ ] `storageKeyForCase(null)` returns null
- [ ] `loadHistory` returns [] when empty
- [ ] `loadHistory` filters `version !== 1`
- [ ] `loadHistory` sorts by `createdAt` desc
- [ ] `saveHistory` caps at 20
- [ ] `saveHistory` on QuotaExceededError drops oldest 5 and retries
- [ ] `buildEntryMetadata` extracts tldr from reportMd

**`src/contexts/__tests__/ReportHistoryContext.test.jsx`**:
- [ ] `addEntry` increases `history.length`
- [ ] `removeEntry` removes only target id
- [ ] `restoreEntry` sets `restoreTarget`
- [ ] case 切替で history リロード

### 11-2. Component Tests（RTL）

**`src/components/report-history/__tests__/ReportHistoryDrawer.test.jsx`**:
- [ ] 空状態時「まだ履歴がありません」表示
- [ ] history 2件 → カード 2 件描画
- [ ] 件数バッジ `2/20` 表示
- [ ] × ボタン / Esc で close
- [ ] 削除ボタンで `removeEntry(id)` 発火
- [ ] 復元ボタンで `restoreEntry(id)` 発火

### 11-3. E2E（webapp-testing skill）

シナリオ:
1. セットアップ → 質問数回 → 期間変更で再セットアップ → ドロワー開いて履歴1件確認
2. 履歴クリック → 復元 → messages 復元 → **Network タブで `neonGenerate` 呼出 0 件**
3. 復元後に新規質問 → `neonGenerate` 呼出 1 件
4. localStorage に 20 件超手動投入 → 新規セットアップで最古 FIFO 削除
5. 案件切替で履歴スコープ切替
6. ダークモード / ライトモード両方で表示崩れなし
7. 全削除 → 空状態 UI 表示

### 11-4. 受け入れ基準

- [ ] ヘッダー key アイコン隣に `history` アイコン表示
- [ ] クリックで右からドロワースライドイン（200ms程度）
- [ ] オーバーレイ/×/Esc で閉じる
- [ ] 再セットアップで前回内容が自動履歴化
- [ ] 履歴空時「まだ履歴がありません」表示
- [ ] リストに日時/期間/クエリタイプ/TL;DR/メッセージ数表示
- [ ] 削除で該当エントリのみ消える
- [ ] 復元で messages と reportBundle が置換
- [ ] 復元時にネットワークリクエストゼロ
- [ ] 復元後の新規質問で API が呼ばれる
- [ ] 案件切替で履歴スコープ切替
- [ ] 20件超は FIFO 削除
- [ ] granularity のみ変更では履歴化されない
- [ ] ライト/ダーク両対応
- [ ] v1/v2 両方で復元動作
- [ ] 既存テスト (`InsightTimeline.test.jsx` 等) パス

---

## 12. Out of Scope（明記）

本プランの対象外:

- **AI 分析品質改善**: プロンプト・モデル・temperature 調整は別プランで実施
- **考察本体の UI 改修**: 見出し絵文字整理、数値ハイライト、関連グラフの情報密度調整は別プラン
- **セットアップウィザード自体の再設計**
- **クラウド同期**（Firestore / Supabase 等）
- **チーム内履歴共有**
- **履歴エントリのタイトル編集・タグ付け・検索・エクスポート**
- **他画面（Creative Review / Compare / Discovery）の履歴機能**

---

## 13. 実装者向け参照表

| 疑問 | 参照 |
|---|---|
| APIキーアイコン配置とフォーカストラップ | [Layout.jsx:568-599, 133-305](src/components/Layout.jsx#L568-L599) |
| `completeSetup` の副作用順序 | [AdsSetupContext.jsx:232-248](src/contexts/AdsSetupContext.jsx#L232-L248) |
| `reportBundle.source` の既存ガード | [AiExplorer.jsx:141](src/pages/AiExplorer.jsx#L141) |
| sessionStorage ドラフト形式 | [AnalysisRunsContext.jsx:22-33](src/contexts/AnalysisRunsContext.jsx#L22-L33), [AiExplorer.jsx:121-128](src/pages/AiExplorer.jsx#L121-L128) |
| case_id ベースストレージキー命名 | [AdsSetupContext.jsx:20-22](src/contexts/AdsSetupContext.jsx#L20-L22), [marketLens.js:114](src/api/marketLens.js#L114) |
| ルーティング & SetupGuard | [App.jsx:65-74, 113](src/App.jsx#L65-L74) |
| `messages` スキーマ | [AiExplorer.jsx:87-95, 341-365](src/pages/AiExplorer.jsx#L87-L95) |
| `reportBundle` 構造 | [adsReports.js](src/utils/adsReports.js) の `buildAdsReportBundle` |
| v2 timeline の messages 依存 | [InsightTimeline.jsx:36-74](src/components/ai-explorer/v2/InsightTimeline.jsx#L36-L74) (`groupMessagesIntoTurns`) |
| ダークモード CSS 変数 | [ThemeContext.jsx](src/contexts/ThemeContext.jsx), `--color-surface-container-low` 等 |

---

### Critical Files

- [src/contexts/AdsSetupContext.jsx](src/contexts/AdsSetupContext.jsx)
- [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx)
- [src/components/Layout.jsx](src/components/Layout.jsx)
- `src/contexts/ReportHistoryContext.jsx`（新規）
- `src/components/report-history/ReportHistoryDrawer.jsx`（新規）
- `src/utils/reportHistoryStorage.js`（新規）

---

## 14. Follow-up: ダークモード描画バグ調査プラン（2026-04-21 追記）

### 14-1. Context

PR #61（dec2bd1）マージ後、ユーザー報告:

> ダークモードが全然ダークじゃないんだよなあ、、、履歴は反映されていました！

履歴機能は正常動作。ただし `/ads/ai` でダークモード有効中に履歴ドロワーを開くと、**ドロワー本体だけ白く描画される**（他画面は正しくダーク）。スクリーンショット2枚で確認済み。

### 14-2. 静的解析で判明した事実

| 観点 | 結論 |
|---|---|
| `bg-surface-container-lowest` の定義 | `background-color: var(--color-surface-container-lowest)` — var()参照で正しい |
| ダークモード override | `:root[data-theme=dark]{--color-surface-container-lowest:#0f1512;…}` がビルド済CSSに存在 (offset 163200) |
| `.lp-page` 内の `#ffffff` override | `.lp-page` スコープ限定、`/ads/ai` 未適用 |
| ハードコード色の混入 | `src/components/report-history/` 配下に `#fff`/`bg-white`/`rgb(255…)` **ゼロ** |
| 他モーダル比較 | `KeySettingsModal` も同じ `bg-surface-container-lowest` 使用、ユーザー報告無し → 単体で壊れている可能性は低い |
| ThemeContext 適用 | `document.documentElement.dataset.theme = 'dark'` で `:root` に付与、var() カスケード経路は健全 |

### 14-3. 仮説

静的には明確な破綻が見つからない。以下のいずれかが疑わしい:

1. **スタッキングコンテキスト or `transform` の作用**: `aside` の `transform transition-transform` が var() 解決に影響している可能性（通常は影響しないが、実機確認必要）
2. **ブラウザキャッシュ**: 古いビルドのCSSをユーザーが見ている可能性（PR #61 のバンドルハッシュ更新で解消するはず）
3. **描画タイミング**: マウント直後は `data-theme` がまだ設定されていない瞬間があり、初期描画で light トークンが焼き付いている可能性
4. **実は別要素が白く見えている**: shadow-2xl、ホバー状態の `bg-surface-container` などが視覚的に白く見えているだけで、実態は想定通りの `#0f1512` 付近（暗色）の可能性

静的解析ではこれ以上特定不可。実機の `getComputedStyle` 値が必要じゃ。

### 14-4. 調査手順（webapp-testing skill 使用）

```python
# scripts/with_server.py で dev server 起動後
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:3002/ads/ai')
    page.wait_for_load_state('networkidle')

    # 1. ダークモード有効化
    page.click('[aria-label*="ダークモード"]')
    page.wait_for_timeout(300)

    # 2. html の data-theme を確認
    theme = page.evaluate('document.documentElement.dataset.theme')
    print(f'theme attr: {theme}')

    # 3. :root の var() 値を確認
    root_lowest = page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--color-surface-container-lowest")')
    print(f'root --color-surface-container-lowest: {root_lowest}')

    # 4. 履歴アイコンクリック
    page.click('[aria-label="レポート履歴を開く"]')
    page.wait_for_timeout(400)

    # 5. ドロワー内層 div の computed 値を取得
    drawer_bg = page.evaluate('''() => {
      const aside = document.querySelector('[aria-labelledby="report-history-title"]')
      const inner = aside?.querySelector('.bg-surface-container-lowest')
      if (!inner) return { error: 'inner div not found' }
      const cs = getComputedStyle(inner)
      return {
        backgroundColor: cs.backgroundColor,
        varValue: cs.getPropertyValue('--color-surface-container-lowest'),
        dataThemeOnHtml: document.documentElement.dataset.theme,
        boundingRect: inner.getBoundingClientRect(),
      }
    }''')
    print(drawer_bg)

    # 6. スクリーンショット
    page.screenshot(path='/tmp/drawer-dark-mode.png', full_page=True)
    browser.close()
```

想定される結果別の判断:

| computed `backgroundColor` | 判定 |
|---|---|
| `rgb(15, 21, 18)` (= `#0f1512`) | バグは視覚的錯覚。他の要素が白く見えている。該当要素を特定して修正 |
| `rgb(255, 255, 255)` | var() が light のまま。`data-theme` 伝播の問題。ThemeContext 初回 applyTheme 前のレース条件を疑う |
| その他 | 新規仕様違反。個別調査 |

### 14-5. 修正方針（結果別）

**結果が `#0f1512` の場合**（視覚的錯覚）:

- スクリーンショットと実測値をユーザーに提示
- 必要ならトーンを一段濃く: `bg-surface-container-lowest` → `bg-surface` 等でコントラスト強化

**結果が `#ffffff` の場合**（var() 未解決）:

- ThemeContext の初期化タイミングを修正: `applyTheme` を `useLayoutEffect` または main.jsx の ThemeProvider マウント前にインライン `<script>` で実行
- あるいは `index.html` に `<html data-theme="light">` を初期値として静的挿入、ThemeProvider 側で即座に更新
- 参考: Next.js の `next-themes` パッケージが採用する no-flash スクリプトパターン

### 14-6. 検証項目

- [ ] Playwright で dark mode トグル → ドロワー open → computed backgroundColor が `rgb(15, 21, 18)` 付近
- [ ] スクリーンショット比較で、他のモーダル（KeySettingsModal / GuideModal）と同等の暗さ
- [ ] ハードリロード後も dark モードが即座に適用される（白フラッシュ無し）
- [ ] localStorage を clear した状態で最初のロードが light、toggle で dark 即座に反映
- [ ] 履歴アイテム hover 時の `bg-surface-container` も暗色のまま

### 14-7. Out of Scope

- 他画面のダークモード追加対応（既に PR #53 で v2 対応済み）
- `prefers-color-scheme` 自動追従（現状は手動トグルのみの仕様）
- テーマカラー自体の再設計
