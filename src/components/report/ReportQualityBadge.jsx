import { useState } from 'react'
import { useRbac } from '../../contexts/RbacContext'
import { splitIssuesBySeverity } from '../../utils/reportQuality'

/**
 * Phase Q2-1: Small chip badge that shows report quality status for operators.
 * Completely hidden from client view. Never appears in print output.
 *
 * Props:
 *   issues        – string[] of quality issue messages from backend
 *   onRegenerate  – () => void called when CTA is clicked
 *   visible       – boolean override (false → renders null)
 */
export default function ReportQualityBadge({ issues = [], onRegenerate, visible = true }) {
  const [open, setOpen] = useState(false)

  // Phase Q2-2: RBAC gate — operators only.
  let showBadge = false
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { isAdmin, user } = useRbac()
    const isClientView = new URLSearchParams(window.location.search).get('viewer') === 'client'
    if (isClientView) {
      showBadge = false
    } else if (isAdmin) {
      showBadge = true
    } else if (!user && import.meta.env.DEV) {
      // Dev mode without auth: show badge so developers can see quality state.
      showBadge = true
    }
  } catch {
    // Outside RbacProvider (e.g. Storybook) — show in DEV only.
    if (import.meta.env.DEV) showBadge = true
  }

  if (!visible || !showBadge) return null

  const { blockers, warnings } = splitIssuesBySeverity(issues)
  const status = blockers.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'pass'

  const chipStyles = {
    critical: 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
    pass: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  }

  const chipIcons = {
    critical: 'error',
    warning: 'warning',
    pass: 'check_circle',
  }

  const chipLabels = {
    critical: 'レポート品質: 要確認',
    warning: 'レポート品質: 注意',
    pass: 'レポート品質: 正常',
  }

  return (
    <div className="relative print:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-bold transition-colors ${chipStyles[status]}`}
        aria-expanded={open}
        aria-label={chipLabels[status]}
      >
        <span className="material-symbols-outlined text-[13px] leading-none">{chipIcons[status]}</span>
        {chipLabels[status]}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-surface rounded-xl shadow-lg border border-outline-variant/20 p-3">
            <p className="text-[11px] font-bold text-on-surface mb-2">品質チェック詳細 (admin only)</p>
            {blockers.length === 0 && warnings.length === 0 ? (
              <p className="text-[11px] text-emerald-700">品質問題なし ✓</p>
            ) : (
              <ul className="text-[11px] space-y-1 mb-3">
                {blockers.map((issue, i) => (
                  <li key={i} className="flex items-start gap-1 text-red-700">
                    <span className="material-symbols-outlined text-[12px] mt-0.5 shrink-0">error</span>
                    {issue}
                  </li>
                ))}
                {warnings.map((issue, i) => (
                  <li key={i} className="flex items-start gap-1 text-amber-700">
                    <span className="material-symbols-outlined text-[12px] mt-0.5 shrink-0">warning</span>
                    {issue}
                  </li>
                ))}
              </ul>
            )}
            {blockers.length > 0 && onRegenerate && (
              <button
                onClick={() => { setOpen(false); onRegenerate() }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                対象を絞って再実行
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
