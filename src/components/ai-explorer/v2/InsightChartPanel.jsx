import { useState } from 'react'
import ChartGroupCard from '../../ads/ChartGroupCard'

/**
 * InsightChartPanel — accordion that renders related-chart cards below the AI
 * markdown body inside an InsightTurnCard. Phase 2 introduces this panel so
 * that relevant chartGroups surface alongside the narrative without clutter.
 *
 * Props:
 *   groups: Array<ChartGroup> — the subset of reportBundle.chartGroups that
 *     matched the AI response. When empty, this component renders nothing.
 *
 * Default expansion rule: open when groups.length <= 2, collapsed otherwise.
 */
export default function InsightChartPanel({ groups }) {
  const list = Array.isArray(groups) ? groups : []
  const [expanded, setExpanded] = useState(list.length > 0 && list.length <= 2)

  if (list.length === 0) return null

  const toggle = () => setExpanded((prev) => !prev)

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant/20">
      <div
        className="flex items-center justify-between cursor-pointer py-2"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-testid="insight-chart-panel-header"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary shrink-0">
            <span className="material-symbols-outlined">psychology</span>
          </div>
          <h3 className="text-base font-bold text-on-surface japanese-text">
            {`関連データグラフを展開 (${list.length})`}
          </h3>
        </div>
        <button
          type="button"
          aria-label="toggle"
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low/60"
        >
          <span className="material-symbols-outlined">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </button>
      </div>

      {expanded && (
        <div
          className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6"
          data-testid="insight-chart-panel-body"
        >
          {list.map((group, index) => (
            <ChartGroupCard key={group?.title ? `${group.title}-${index}` : `chart-${index}`} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}
