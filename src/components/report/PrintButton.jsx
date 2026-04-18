import { useCallback } from 'react'

/**
 * Minimal PDF button — triggers the browser print dialog.
 * A dedicated print stylesheet (src/styles/print.css) handles page layout.
 */
export default function PrintButton({ label = 'PDF印刷', className = '' }) {
  const handleClick = useCallback(() => {
    if (typeof window !== 'undefined') window.print()
  }, [])

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg transition-colors print:hidden ${className}`}
      aria-label={label}
    >
      <span className="material-symbols-outlined text-sm">print</span>
      {label}
    </button>
  )
}
