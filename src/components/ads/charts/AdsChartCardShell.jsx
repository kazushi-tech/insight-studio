import { useMemo, useState } from 'react'

const WARNING_LABELS = {
  low_sample: '低サンプル',
  missing_label: 'ラベル欠損',
  missing_values: '欠損あり',
  label_data_mismatch: '系列不一致',
  overflow_values: '余剰値あり',
  flat_series: '比較差なし',
}

function safeId(title) {
  return `chart-card-${String(title || 'chart').replace(/[^\w-]+/g, '-')}`
}

export default function AdsChartCardShell({
  group,
  modeLabel,
  message,
  children,
  defaultCollapsed = false,
  featured = false,
}) {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed))
  const contentId = useMemo(() => safeId(`${group?.title ?? ''}-${group?._periodTag ?? ''}`), [group])
  const warnings = Array.isArray(group?.warnings) ? group.warnings : []
  const coverageLabel = group?.coverageLabel || group?.metadata?.coverageLabel
  const selectionLabel = group?.selectionLabel || group?.metadata?.selectionLabel

  return (
    <article className={`overflow-hidden rounded-2xl border border-primary/10 bg-surface-container-lowest shadow-sm ${featured ? 'ring-1 ring-primary/10' : ''}`}>
      <div className="border-b border-primary/10 bg-[#fbfcf7] px-5 py-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {modeLabel && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.06] px-3 py-1 text-[10px] font-black tracking-[0.08em] text-primary">
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">analytics</span>
                  {modeLabel}
                </span>
              )}
              {group?._periodTag && (
                <span className="rounded-full bg-surface-container-low px-3 py-1 text-[10px] font-black text-on-surface-variant">
                  {group._periodTag}
                </span>
              )}
              {warnings.map((warning) => (
                <span key={warning} className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black text-amber-800">
                  {WARNING_LABELS[warning] ?? warning}
                </span>
              ))}
            </div>

            <h3 className="mt-3 truncate text-xl font-black text-on-surface japanese-text" title={group?.title}>
              {group?.title || '無題グラフ'}
            </h3>
            <p className="mt-1 text-sm font-bold leading-6 text-on-surface-variant japanese-text">
              {message || '主指標を先に見せ、詳細値はホバー・表で確認できます。'}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {selectionLabel && (
                <span className="rounded-lg border border-primary/10 bg-primary/[0.045] px-3 py-1 text-[11px] font-black text-primary">
                  {selectionLabel}
                </span>
              )}
              {coverageLabel && (
                <span className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-1 text-[11px] font-black text-on-surface-variant">
                  実数: {coverageLabel}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            title={collapsed ? 'グラフを開く' : 'グラフを閉じる'}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setCollapsed((value) => !value)}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-white text-primary shadow-sm transition hover:bg-primary hover:text-on-primary"
          >
            <span className={`material-symbols-outlined text-xl transition-transform ${collapsed ? '' : 'rotate-180'}`} aria-hidden="true">
              expand_more
            </span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id={contentId} className="space-y-5 p-5 lg:p-6">
          {children}
        </div>
      )}
    </article>
  )
}
