import { useState, useEffect, useRef, useCallback } from 'react'

const GUIDE_PAGES = [
  {
    src: null,
    title: 'Insight Studio へようこそ',
    description: 'このガイドでは、設定済みの分析プロバイダーで比較・発見・レビュー・Ads AI を進める流れを扱います。',
    items: [
      { icon: 'compare_arrows', title: 'LP比較・競合分析', body: 'URLを入力して、自社LPと競合LPの差分、優先施策、期待KPIを確認します。' },
      { icon: 'travel_explore', title: '競合発見', body: 'ブランドURLから候補を発見し、直接競合・隣接競合・参考サイトを分けて分析します。' },
      { icon: 'rate_review', title: 'クリエイティブレビュー', body: 'バナーやLPの訴求、CTA、信頼要素、広告-LP一致をレビューします。' },
    ],
  },
  {
    src: null,
    title: 'APIキーの設定',
    description: 'Gemini または Claude の分析用 API キーを設定すると Compare / Discovery / Creative Review を開始できます。',
    items: [
      { icon: 'key', title: 'Gemini優先', body: 'Geminiキーが保存されている場合、分析系フローではGeminiを優先します。' },
      { icon: 'swap_horiz', title: 'Claudeはフォールバック', body: 'Gemini未設定時はClaudeキーを分析用フォールバックとして使います。' },
      { icon: 'lock', title: 'Ads AIは別条件', body: 'Ads AIは分析用APIキーに加えて、案件認証とセットアップ完了が必要です。' },
    ],
  },
  {
    src: null,
    title: 'LP比較 & 競合発見',
    description: 'LP比較と競合発見は、設定済みの分析プロバイダーで実行します。Gemini キーがある場合は Gemini が優先されます。',
    items: [
      { icon: 'flag', title: 'Action Board', body: '生成後はまず最優先施策、期待KPI、信頼度、最初の一手を確認します。' },
      { icon: 'scatter_plot', title: 'ポジションマップ', body: '競合を獲得導線と信頼訴求の2軸で見て、勝ち筋と保留点を把握します。' },
      { icon: 'fact_check', title: '根拠トレース', body: '評価保留と確認済み根拠を分け、低評価とデータ不足を混同しない設計です。' },
    ],
  },
  {
    src: null,
    title: '広告分析ワークフロー',
    description: 'Ads AI は分析用 API キーに加えて、案件認証と Ads セットアップ完了が前提です。',
    items: [
      { icon: 'admin_panel_settings', title: '案件認証', body: '未認証時は安全な案内を表示し、赤い障害表示で不安を煽らないようにしています。' },
      { icon: 'query_stats', title: 'セットアップ', body: '期間、媒体、粒度をセットしてから、グラフとAI考察へ進みます。' },
      { icon: 'chat', title: 'Ads AI', body: '数値、期間、変化要因、次アクションに紐づく回答を目指します。' },
    ],
  },
  {
    src: null,
    title: 'クリエイティブレビュー',
    description: 'Creative Review は設定済みの分析プロバイダーでバナーを分析・評価します。',
    items: [
      { icon: 'upload_file', title: '画像アップロード', body: 'PNG/JPG/WebPをアップロードし、必要に応じてブランド情報やLP URLを添えます。' },
      { icon: 'radar', title: '評価レーダー', body: '視線誘導、訴求、CTA、信頼要素などをスコアと講評で確認します。' },
      { icon: 'science', title: 'A/Bテスト案', body: '改善案は実務で試せる仮説として出し、効果断定を避けます。' },
    ],
  },
  {
    src: null,
    title: 'Tips & ショートカット',
    description: 'smoke 確認時は Compare → Discovery → Creative Review → Ads AI の順で見ると切り分けしやすくなります。',
    items: [
      { icon: 'content_copy', title: 'コピー', body: '生成レポートは上部のコピー導線から共有用テキストとして取り出せます。' },
      { icon: 'print', title: '印刷', body: '詳細レポートは印刷/PDF化しやすいレイアウトで確認できます。' },
      { icon: 'keyboard', title: 'キーボード操作', body: 'モーダル、目次、主要ボタンはフォーカス表示を保つようにしています。' },
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
          {current.src ? (
            <img
              src={current.src}
              alt={current.title}
              className="w-full rounded-[0.75rem] object-contain"
              draggable={false}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {current.items?.map((item) => (
                <article key={item.title} className="rounded-[0.75rem] bg-surface-container-low p-5 min-h-[180px] flex flex-col gap-3">
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
