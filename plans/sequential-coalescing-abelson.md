# Plan: AI考察チャット履歴の永続化 + 文字サイズ調整

## Context

AI考察ページ (`/ads/ai`) でページ遷移するとチャット履歴が消える問題。
競合LP分析 (Compare.jsx) は `AnalysisRunsContext` の `getDraft/setDraft` パターンで永続化済み。
同じパターンを AiExplorer.jsx に適用する。

併せて、AI考察の文字サイズを 小/中/大 で切り替えられるUIを追加する。
MarkdownRenderer は既に `normal/large/xlarge` の SIZE_PRESETS を持っているので、
それを活用してユーザー選択可能にする。

---

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| [AiExplorer.jsx](src/pages/AiExplorer.jsx) | 永続化ロジック + 文字サイズUI + チャット消去ボタン |

**変更不要**: `AnalysisRunsContext.jsx`, `MarkdownRenderer.jsx` — 既に必要な機能あり

---

## Feature 1: チャット履歴の永続化

### Step 1: useAnalysisRuns をインポート

```javascript
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
```

### Step 2: 既存 useState を getDraft 初期化に変更

```javascript
const { getDraft, setDraft, clearDraft } = useAnalysisRuns()

// messages: sessionStorage から復元、最大50件、バリデーション付き
const [messages, setMessages] = useState(() => {
  const draft = getDraft('ai-explorer')
  if (!draft || !Array.isArray(draft.messages)) return []
  return draft.messages
    .filter((m) => m && typeof m.role === 'string' && typeof m.text === 'string')
    .slice(-50)
})

// contextMode: sessionStorage から復元
const [contextMode, setContextMode] = useState(() => {
  const draft = getDraft('ai-explorer')
  return draft?.contextMode === 'ads-with-ml' ? 'ads-with-ml' : 'ads-only'
})
```

### Step 3: useEffect で状態変更を sessionStorage に同期

```javascript
useEffect(() => {
  setDraft('ai-explorer', { messages: messages.slice(-50), contextMode })
}, [messages, contextMode, setDraft])
```

### Step 4: チャット消去ボタンを追加

「コンテキスト更新」ボタンの横に配置:

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

---

## Feature 2: 文字サイズ調整

### Step 5: fontSize state を localStorage で永続化

```javascript
const FONT_SIZE_KEY = 'is-ai-chat-font-size'

const [fontSize, setFontSize] = useState(() => {
  const saved = localStorage.getItem(FONT_SIZE_KEY)
  return saved === 'large' || saved === 'xlarge' ? saved : 'normal'
})

function handleFontSizeChange(size) {
  setFontSize(size)
  localStorage.setItem(FONT_SIZE_KEY, size)
}
```

**localStorage を使う理由**: 文字サイズはユーザー設定なのでセッション跨ぎで永続化すべき

### Step 6: サイズ切替 UI を追加

Context トグルの横に、同じデザインパターンで配置:

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

### Step 7: MarkdownRenderer に size prop を渡す

アシスタントメッセージ（現在 `className="text-sm"`）:
```javascript
// Before:
<MarkdownRenderer content={message.text} className="text-sm" />
// After:
<MarkdownRenderer content={message.text} size={fontSize} />
```

ユーザーメッセージ（現在 `text-sm`）:
```javascript
<p className={`leading-relaxed text-on-primary japanese-text ${
  fontSize === 'xlarge' ? 'text-lg' : fontSize === 'large' ? 'text-base' : 'text-sm'
}`}>
```

ローディング表示も同様にサイズ反映。

---

## 検証方法

1. `npm run dev` で開発サーバー起動
2. AI考察ページで質問を送信し、チャット履歴が表示されることを確認
3. **別ページ（ダッシュボード等）に遷移してから戻り、チャット履歴が残っていることを確認**
4. 「チャット消去」ボタンで履歴がクリアされることを確認
5. 文字サイズトグル（小/中/大）を切り替えて、AI応答の文字サイズが変わることを確認
6. ページリロード後も文字サイズ設定が維持されることを確認
7. `npm run build` でビルドエラーなしを確認
