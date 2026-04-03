import { useState, useEffect, useRef, useCallback } from 'react'

const GUIDE_PAGES = [
  {
    src: '/guide/page1-welcome.png',
    title: 'Insight Studio へようこそ',
    description: 'このガイドでは Claude First を前提に、比較・発見・レビュー・Ads AI を主要フローとして扱います。',
  },
  {
    src: '/guide/page2-api-setup.png',
    title: 'APIキーの設定',
    description: 'Claude API キーを設定すると Compare / Discovery / Ads AI / Creative Review(review) を開始できます。',
    callout: 'Gemini API キーは改善バナー生成だけで使う任意設定です。',
  },
  {
    src: '/guide/page3-lp-analysis.png',
    title: 'LP比較 & 競合発見',
    description: 'LP比較と競合発見は Claude で実行します。Gemini 未設定でも利用不可にはしません。',
  },
  {
    src: '/guide/page4-ads-insight.png',
    title: '広告分析ワークフロー',
    description: 'Ads AI は Claude API キーに加えて、案件認証と Ads セットアップ完了が前提です。',
  },
  {
    src: '/guide/page5-creative.png',
    title: 'クリエイティブレビュー',
    description: 'Creative Review の core は Claude レビューです。',
    callout: '改善バナー生成は Gemini を使う optional / experimental addon として扱います。',
  },
  {
    src: '/guide/page6-tips.png',
    title: 'Tips & ショートカット',
    description: 'smoke 確認時は Compare → Discovery → Creative Review → Ads AI の順で見ると切り分けしやすくなります。',
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="使い方ガイド"
        tabIndex={-1}
        className="bg-surface-container-lowest rounded-xl shadow-lg w-[900px] max-w-[92vw] max-h-[90vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary">menu_book</span>
            <h3 className="text-lg font-bold japanese-text">{current.title}</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface-variant">
              {page + 1} / {GUIDE_PAGES.length}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
              aria-label="閉じる"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Image Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <img
            src={current.src}
            alt={current.title}
            className="w-full rounded-[0.75rem] object-contain"
            draggable={false}
          />
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-outline-variant/10">
          <button
            onClick={goPrev}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            前へ
          </button>

          {/* Center: dots + don't show again */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              {GUIDE_PAGES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  aria-label={`ページ ${i + 1}`}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === page
                      ? 'bg-secondary scale-110'
                      : 'bg-outline-variant/40 hover:bg-outline-variant/70'
                  }`}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
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
                className="w-3.5 h-3.5 rounded accent-secondary"
              />
              <span className="text-[11px] text-on-surface-variant japanese-text">次回から表示しない</span>
            </label>
          </div>

          <button
            onClick={page === GUIDE_PAGES.length - 1 ? onClose : goNext}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-surface-container text-on-surface-variant"
          >
            {page === GUIDE_PAGES.length - 1 ? (
              <>
                完了
                <span className="material-symbols-outlined text-[18px]">check</span>
              </>
            ) : (
              <>
                次へ
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
