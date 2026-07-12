import { useState, useEffect, useRef, useCallback } from 'react'

const GUIDE_PAGES = [
  {
    src: '/imagegen/data-to-action-paper-collage.webp',
    title: 'まずはサイトの状態を確認',
    description: '基本レポート・グラフ・根拠整理は、追加のサービス設定なしで利用できます。',
    items: [
      { icon: 'summarize', title: 'まとめ', body: '重要な変化、判断を保留する項目、次に確認することを先に読みます。' },
      { icon: 'monitoring', title: 'グラフ', body: 'アクセス数、来訪元、ページ、成果を期間と一緒に確認します。' },
      { icon: 'tune', title: '分析条件', body: '対象サイト、期間、見る項目を選び直し、必要な範囲だけを表示します。' },
    ],
  },
  {
    src: null,
    title: 'Webサイトの計測データを接続',
    description: '実際の数字を表示するには、計測データの接続が必要です。画面の「準備」から順番に確認できます。',
    items: [
      { icon: 'web', title: 'サイトを選ぶ', body: '分析するWebサイトと接続先を選択します。' },
      { icon: 'date_range', title: '期間を選ぶ', body: 'まずは直近28日など、比較しやすい期間から始めます。' },
      { icon: 'verified', title: '取得状態を確認', body: '未取得・一部取得・取得済みを区別し、ないデータを推測で補いません。' },
    ],
  },
  {
    src: null,
    title: '追加分析は必要なときだけ',
    description: '競合・入口ページ分析や画像診断は、導入担当者が利用範囲を確認してから有効にします。基本レポートはそのまま利用できます。',
    items: [
      { icon: 'check_circle', title: '基本機能', body: 'レポート、グラフ、根拠に基づく自動整理を利用できます。' },
      { icon: 'smart_toy', title: '詳しい調査', body: '競合・入口ページ・画像を、必要な案件だけ追加で調べます。' },
      { icon: 'support_agent', title: '導入担当者', body: '利用権限、費用、データの扱いを確認してから設定します。' },
    ],
  },
  {
    src: null,
    title: '必要なら高度な分析へ',
    description: '基本のサイト分析で課題を見つけたあとに、高度な分析を使います。最初から全機能を覚える必要はありません。',
    items: [
      { icon: 'compare_arrows', title: '競合・LP比較', body: '自社と競合の訴求、CTA、信頼要素の違いを整理します。' },
      { icon: 'travel_explore', title: '競合候補の発見', body: '候補を直接競合・隣接競合・参考サイトに分けて確認します。' },
      { icon: 'rate_review', title: 'クリエイティブ診断', body: '広告画像の訴求、視線誘導、CTA、LPとの一致を確認します。' },
    ],
  },
  {
    src: null,
    title: '結果は根拠から読む',
    description: 'AIの文章より先に、期間・数値・取得状態を確認します。判断できない項目は「未取得」として残します。',
    items: [
      { icon: 'fact_check', title: '確認済み', body: '取得できたデータと、そのデータから直接言えることを表示します。' },
      { icon: 'help', title: '判断保留', body: 'データ不足や定義不足を、低評価と混同せずに分けて表示します。' },
      { icon: 'task_alt', title: '次の一手', body: '誰が、何を、どの順番で確認するかまで落とし込みます。' },
    ],
  },
]

const STORAGE_KEY = 'insight-studio-guide-seen'

export default function GuideModal({ onClose }) {
  const [page, setPage] = useState(0)
  const [dontShowAgain, setDontShowAgain] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  )
  const modalRef = useRef(null)

  const goNext = useCallback(() => setPage((p) => Math.min(p + 1, GUIDE_PAGES.length - 1)), [])
  const goPrev = useCallback(() => setPage((p) => Math.max(p - 1, 0)), [])

  useEffect(() => {
    const prev = document.activeElement
    modalRef.current?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { goNext(); return }
      if (e.key === 'ArrowLeft') { goPrev(); return }

      // Focus trap
      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      prev?.focus()
    }
  }, [onClose, goNext, goPrev])

  const current = GUIDE_PAGES[page]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="使い方ガイド"
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary" aria-hidden="true">menu_book</span>
            <h3 className="text-lg font-bold japanese-text">{current.title}</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface-variant">
              {page + 1} / {GUIDE_PAGES.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-secondary"
              aria-label="閉じる"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
            </button>
          </div>
        </div>

        {/* Image Content */}
        <div
          className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6"
          role="region"
          aria-label="ガイド内容"
          tabIndex={0}
        >
          {current.src && (
            <img
              src={current.src}
              alt={current.title}
              width="1536"
              height="1024"
              className="max-h-64 w-full rounded-[0.75rem] object-cover object-center"
              draggable={false}
            />
          )}
          {current.items?.length > 0 && (
            <div className={`grid grid-cols-1 gap-4 md:grid-cols-3 ${current.src ? 'mt-4' : ''}`}>
              {current.items?.map((item) => (
                <article key={item.title} className="flex min-w-0 flex-col gap-3 rounded-[0.75rem] bg-surface-container-low p-5 md:min-h-[180px]">
                  <span className="material-symbols-outlined text-secondary text-3xl" aria-hidden="true">{item.icon}</span>
                  <h4 className="text-base font-bold text-on-surface japanese-text">{item.title}</h4>
                  <p className="text-sm leading-6 text-on-surface-variant japanese-text">{item.body}</p>
                </article>
              ))}
            </div>
          )}
          {(current.description || current.callout) && (
            <div className="mt-4 rounded-[0.75rem] bg-surface-container p-4 space-y-2">
              {current.description && (
                <p className="text-sm text-on-surface japanese-text">{current.description}</p>
              )}
              {current.callout && (
                <p className="text-xs text-secondary japanese-text">{current.callout}</p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t border-outline-variant/10 px-4 py-3 sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={goPrev}
            disabled={page === 0}
            className="flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
            前へ
          </button>

          {/* Center: dots + don't show again */}
          <div className="flex min-w-0 flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              {GUIDE_PAGES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  aria-label={`ページ ${i + 1}`}
                  className={`min-h-11 min-w-11 rounded-full border-[14px] border-transparent bg-clip-padding transition-transform ${
                    i === page
                      ? 'bg-secondary scale-110'
                      : 'bg-outline-variant/40 hover:bg-outline-variant/70'
                  }`}
                />
              ))}
            </div>
            <label className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-2">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => {
                  setDontShowAgain(e.target.checked)
                  if (e.target.checked) {
                    localStorage.setItem(STORAGE_KEY, '1')
                  } else {
                    localStorage.removeItem(STORAGE_KEY)
                  }
                }}
                className="size-4 rounded accent-secondary"
              />
              <span className="text-[11px] text-on-surface-variant japanese-text">次回から表示しない</span>
            </label>
          </div>

          <button
            type="button"
            onClick={page === GUIDE_PAGES.length - 1 ? onClose : goNext}
            className="flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            {page === GUIDE_PAGES.length - 1 ? (
              <>
                完了
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span>
              </>
            ) : (
              <>
                次へ
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
