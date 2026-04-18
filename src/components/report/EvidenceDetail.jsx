import { useEffect } from 'react'
import JudgmentBadge from './JudgmentBadge'

/**
 * Slide-in drawer showing evidence for a single brand × axis combination.
 * Controlled via `open` + `onClose`. When closed, returns null to avoid
 * pointer-events overhead on the main canvas.
 */
export default function EvidenceDetail({ open, onClose, brand, axis, cell }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !cell) return null

  return (
    <div
      className="fixed inset-0 z-40 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={`${brand} の ${axis} に関する評価詳細`}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onClose?.()}
        aria-hidden="true"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-surface-container-lowest shadow-2xl overflow-y-auto">
        <header className="flex items-center justify-between gap-2 p-5 border-b border-outline-variant/20 sticky top-0 bg-surface-container-lowest z-10">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-1">
              評価詳細
            </div>
            <div className="text-sm font-bold text-on-surface truncate" title={brand}>
              {brand}
            </div>
            <div className="text-xs text-on-surface-variant">{axis}</div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="shrink-0 rounded-full p-2 hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="閉じる"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              close
            </span>
          </button>
        </header>

        <div className="p-5 space-y-5 text-sm">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant mb-2">
              判定
            </div>
            <JudgmentBadge verdict={cell.verdict ?? '評価保留'} size="md" />
          </div>

          {cell.evidence && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant mb-2">
                証拠強度
              </div>
              <div className="text-on-surface">{cell.evidence}</div>
            </div>
          )}

          {cell.reason && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant mb-2">
                根拠
              </div>
              <p className="text-on-surface leading-relaxed whitespace-pre-wrap">{cell.reason}</p>
            </div>
          )}

          {!cell.evidence && !cell.reason && (
            <div className="text-on-surface-variant italic">
              この軸の詳細な根拠データは提供されていません。
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
