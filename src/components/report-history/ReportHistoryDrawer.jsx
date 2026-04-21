import { useEffect, useRef } from 'react'
import { useReportHistory } from '../../contexts/ReportHistoryContext'
import ReportHistoryItem from './ReportHistoryItem'

export default function ReportHistoryDrawer({ open, onClose }) {
  const { history, removeEntry, restoreEntry, clearAll, maxEntries } = useReportHistory()
  const asideRef = useRef(null)
  const previouslyFocused = useRef(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement
    asideRef.current?.querySelector('button, [tabindex]:not([tabindex="-1"])')?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const el = asideRef.current
      if (!el) return
      const focusables = el.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus?.()
      }
    }
  }, [open, onClose])

  const handleClearAll = () => {
    if (history.length === 0) return
    const ok = window.confirm('すべての履歴を削除しますか？この操作は取り消せません。')
    if (ok) clearAll()
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[99] bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-history-title"
        aria-hidden={!open}
        className={`fixed top-0 right-0 h-full z-[100] w-[460px] max-w-full transform transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="bg-surface-container-low shadow-2xl h-full flex flex-col border-l border-outline-variant/40">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/30">
            <div className="flex items-center gap-2">
              <h3 id="report-history-title" className="text-base font-bold japanese-text text-on-surface">
                レポート履歴
              </h3>
              <span className="text-[11px] font-bold text-on-surface-variant bg-surface-container-high rounded-full px-2 py-0.5 tabular-nums">
                {history.length}/{maxEntries}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
              aria-label="レポート履歴を閉じる"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* List or Empty */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl mb-3 opacity-60">description</span>
                <p className="text-sm font-bold japanese-text mb-1">まだ履歴がありません</p>
                <p className="text-xs japanese-text leading-relaxed">
                  セットアップを再実行すると、<br />
                  前回のレポートが自動保存されます
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {history.map((entry) => (
                  <ReportHistoryItem
                    key={entry.id}
                    entry={entry}
                    onRestore={(id) => {
                      restoreEntry(id)
                      onClose?.()
                    }}
                    onRemove={removeEntry}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {history.length > 0 && (
            <div className="px-6 py-3 border-t border-outline-variant/30">
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs text-on-surface-variant hover:text-error transition-colors japanese-text"
              >
                履歴をすべて削除
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
