# Review & Revised Plan: AI考察チャット履歴の永続化 + 文字サイズ調整

## レビュー結果

元プラン `plans/sequential-coalescing-abelson.md` を調査結果に基づきレビューした。

### 検証済み前提条件

| 前提 | 結果 |
|------|------|
| `getDraft/setDraft/clearDraft` が AnalysisRunsContext にある | ✅ 確認済 (sessionStorage ベース) |
| Compare.jsx が同パターンで永続化済み | ✅ 確認済 (kind='compare') |
| MarkdownRenderer に SIZE_PRESETS (normal/large/xlarge) がある | ✅ 確認済 (lines 63-97) |
| MarkdownRenderer が `size` prop を受け取る | ✅ 確認済 (line 406: `size = 'normal'`) |
| AiExplorer.jsx に永続化ロジックがない | ✅ 確認済 (useState のみ) |

### 発見した問題と修正

| # | 問題 | 修正 |
|---|------|------|
| 1 | Step 7で `className="text-sm"` を削除→`size` に置換しているが、`className` は MarkdownRenderer のラッパーdiv に適用されるため削除不可 | `className` を残しつつ `size` を追加: `<MarkdownRenderer content={message.text} className="text-sm" size={fontSize} />` |
| 2 | ユーザーメッセージの三項演算子が冗長 | マップオブジェクト `USER_TEXT_SIZE` で管理 |
| 3 | ローディング表示の文字サイズ反映が具体コードなし | 具体コードを追記 |
| 4 | チャット消去ボタンの配置位置が不明確 | コンテキスト更新ボタンの横（右側 flex グループ内）に配置 |

---

## Context

AI考察ページ (`/ads/ai`) でページ遷移するとチャット履歴が消える問題。
競合LP分析 (Compare.jsx) は `AnalysisRunsContext` の `getDraft/setDraft` パターンで永続化済み。
同じパターンを AiExplorer.jsx に適用する。

併せて、AI考察の文字サイズを 小/中/大 で切り替えられるUIを追加する。

---

## 変更対象

| ファイル | 変更内容 |
|----------|----------|
| [AiExplorer.jsx](src/pages/AiExplorer.jsx) | 永続化ロジック + 文字サイズUI + チャット消去ボタン |

**変更不要**: `AnalysisRunsContext.jsx`, `MarkdownRenderer.jsx` — 既に必要な機能あり

---

## 実装手順

### Feature 1: チャット履歴の永続化

#### Step 1: import 追加

```javascript
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
```

#### Step 2: getDraft で初期化 (line 79-88 付近を変更)

```javascript
const { getDraft, setDraft, clearDraft } = useAnalysisRuns()

const [messages, setMessages] = useState(() => {
  const draft = getDraft('ai-explorer')
  if (!draft || !Array.isArray(draft.messages)) return []
  return draft.messages
    .filter((m) => m && typeof m.role === 'string' && typeof m.text === 'string')
    .slice(-50)
})

const [contextMode, setContextMode] = useState(() => {
  const draft = getDraft('ai-explorer')
  return draft?.contextMode === 'ads-with-ml' ? 'ads-with-ml' : 'ads-only'
})
```

#### Step 3: useEffect で sessionStorage に同期

```javascript
useEffect(() => {
  setDraft('ai-explorer', { messages: messages.slice(-50), contextMode })
}, [messages, contextMode, setDraft])
```

#### Step 4: チャット消去ボタン (line 369 コンテキスト更新ボタンの横)

```javascript
<button
  onClick={() => { setMessages([]); setStatus(''); clearDraft('ai-explorer') }}
  disabled={messages.length === 0}
  className="px-4 py-2 bg-surface-container text-on-surface-variant rounded-[0.75rem] font-bold text-xs flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
>
  <span className="material-symbols-outlined text-sm">delete_sweep</span>
  チャット消去
</button>
```

### Feature 2: 文字サイズ調整

#### Step 5: fontSize state + localStorage 永続化

```javascript
const FONT_SIZE_KEY = 'is-ai-chat-font-size'
const USER_TEXT_SIZE = { normal: 'text-sm', large: 'text-base', xlarge: 'text-lg' }

const [fontSize, setFontSize] = useState(() => {
  const saved = localStorage.getItem(FONT_SIZE_KEY)
  return saved === 'large' || saved === 'xlarge' ? saved : 'normal'
})

function handleFontSizeChange(size) {
  setFontSize(size)
  localStorage.setItem(FONT_SIZE_KEY, size)
}
```

#### Step 6: サイズ切替 UI (Context トグルと同じデザインパターン)

```javascript
<div className="flex flex-wrap items-center gap-3">
  <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.24em]">Size</p>
  <div className="flex bg-surface-container rounded-full p-0.5">
    {[
      { key: 'normal', label: '小' },
      { key: 'large', label: '中' },
      { key: 'xlarge', label: '大' },
    ].map((opt) => (
      <button
        key={opt.key}
        onClick={() => handleFontSizeChange(opt.key)}
        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
          fontSize === opt.key
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:bg-surface-container-high'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
</div>
```

#### Step 7: MarkdownRenderer に size prop を追加 (className は残す)

**アシスタントメッセージ (line 428):**
```javascript
// Before:
<MarkdownRenderer content={message.text} className="text-sm" />
// After (className を残しつつ size を追加):
<MarkdownRenderer content={message.text} className="text-sm" size={fontSize} />
```

**ユーザーメッセージ (line 435):**
```javascript
// Before:
<p className="text-sm leading-relaxed text-on-primary japanese-text">{message.text}</p>
// After (マップオブジェクトで管理):
<p className={`${USER_TEXT_SIZE[fontSize]} leading-relaxed text-on-primary japanese-text`}>{message.text}</p>
```

**ローディング表示 (line 452):**
```javascript
// Before:
<p className="text-sm text-on-surface-variant japanese-text">考察を生成中…</p>
// After:
<p className={`${USER_TEXT_SIZE[fontSize]} text-on-surface-variant japanese-text`}>考察を生成中…</p>
```

---

## 検証方法

1. `npm run dev` で開発サーバー起動
2. AI考察ページで質問を送信 → チャット履歴表示を確認
3. **別ページに遷移して戻る → チャット履歴が残っていることを確認**
4. 「チャット消去」ボタンで履歴クリアを確認
5. 文字サイズトグル（小/中/大）で AI応答・ユーザーメッセージ・ローディング全ての文字サイズ変化を確認
6. ページリロード後も文字サイズ設定が維持されることを確認（localStorage）
7. ページリロード後はチャット履歴が消えることを確認（sessionStorage = セッション内のみ永続）
8. `npm run build` でビルドエラーなしを確認
