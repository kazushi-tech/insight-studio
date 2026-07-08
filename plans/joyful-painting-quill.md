# AI考察ページ 可読性改善 — Quick Analysis非表示化 + レスポンス表示最適化

## Context

AI考察エンジンページ(`AiExplorer.jsx`)で「見づらい」というユーザーフィードバック。
主な原因: **Quick Analysisカード3枚が常に上部に固定表示され、メインの分析コンテンツを押し下げている**。
会話開始後もカードが残り続け、スクロール量を増やして視認性を低下させている。

## 変更方針

| # | 変更 | ファイル | 影響度 |
|---|------|---------|--------|
| 1 | Quick Analysisカードを「メッセージなし時のみ表示」にする | `AiExplorer.jsx:562-577` | 高 |
| 2 | AI応答メッセージのカード内余白を拡張して見やすくする | `AiExplorer.jsx:599` | 中 |
| 3 | Quick Analysisカードをチャット入力欄内にサジェストchipとして再配置 | `AiExplorer.jsx:633-661` | 中 |

---

## 変更1: Quick Analysisカードの条件付き表示

**ファイル:** [AiExplorer.jsx:562-577](src/pages/AiExplorer.jsx#L562-L577)

現在のコード:
```jsx
<div className="space-y-2">
  <p className="text-[11px] font-bold ...">Quick Analysis</p>
  <div className="grid grid-cols-3 gap-6">
    {QUICK_PROMPTS.map(...)}
  </div>
</div>
```

修正: `messages.length === 0` の条件でラップ。会話開始後は非表示にする。

```jsx
{messages.length === 0 && (
  <div className="space-y-2">
    <p className="text-[11px] font-bold ...">Quick Analysis</p>
    <div className="grid grid-cols-3 gap-6">
      {QUICK_PROMPTS.map(...)}
    </div>
  </div>
)}
```

## 変更2: AI応答メッセージの表示改善

**ファイル:** [AiExplorer.jsx:599](src/pages/AiExplorer.jsx#L599)

現在: `p-6`の余白。テキスト密度が高く詰まって見える。

修正: 余白を`p-8`に増やし、`max-w-5xl`を維持しつつ内部スペーシングを改善。

```jsx
<div className={`bg-surface-container-lowest rounded-2xl rounded-tl-none panel-card-hover p-8 max-w-5xl ...`}>
```

## 変更3: チャット入力欄にQuick Analysisサジェストchipを追加

**ファイル:** [AiExplorer.jsx:633-661](src/pages/AiExplorer.jsx#L633-L661)

会話中もQuick Analysisにアクセスできるよう、入力欄の上にコンパクトなchip行を追加。

```jsx
{/* 入力欄の上にサジェストchip — 会話中のみ表示 */}
{messages.length > 0 && (
  <div className="flex flex-wrap gap-2 mb-2">
    {QUICK_PROMPTS.map((prompt) => (
      <button
        key={prompt.label}
        onClick={() => handleSend(prompt.label)}
        disabled={promptDisabled}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-xs font-medium text-on-surface-variant hover:bg-surface-container-high transition-all disabled:opacity-50"
      >
        <span className={`material-symbols-outlined text-sm ${prompt.color}`}>{prompt.icon}</span>
        <span className="japanese-text">{prompt.label}</span>
      </button>
    ))}
  </div>
)}
```

---

## 期待される効果

1. **会話開始後**: Quick Analysisカード3枚分(約120px)の縦スペースが解放 → 分析コンテンツが即座に視界に入る
2. **サジェストchip**: 会話中でも1行でQuick Analysisにアクセス可能 → 機能性を維持
3. **余白改善**: AI応答の`p-8`でテキスト密度が下がり、読みやすさが向上

## 検証方法

1. `npm run dev` で開発サーバー起動
2. `/ads/ai` ページを開く → Quick Analysisカード3枚が表示されることを確認
3. 任意の質問を送信 → メッセージ表示後、Quick Analysisカードが消え、サジェストchipが入力欄上に表示されることを確認
4. サジェストchipをクリック → 正常に質問が送信されることを確認
5. 「チャット消去」ボタンを押す → Quick Analysisカード3枚が再表示されることを確認
6. AI応答の余白が`p-8`に広がっていることを確認
