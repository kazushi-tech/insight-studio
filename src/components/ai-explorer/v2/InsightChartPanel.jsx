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
export default function InsightChartPanel({
  groups,
  defaultExpanded,
  title = '関連データグラフを展開',
  description = '',
}) {
  const list = Array.isArray(groups) ? groups : []
  const [expanded, setExpanded] = useState(
    typeof defaultExpanded === 'boolean'
      ? defaultExpanded
      : list.length > 0 && list.length <= 2,
  )

  if (list.length === 0) return null

  const toggle = () => setExpanded((prev) => !prev)

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant/20">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg py-2 text-left transition-colors hover:bg-surface-container-low/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        onClick={toggle}
        aria-expanded={expanded}
        data-testid="insight-chart-panel-header"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary shrink-0">
            <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
          </div>
          <div>
            <h3 className="text-base font-bold text-on-surface japanese-text">
              {`${title} (${list.length})`}
            </h3>
            {description && (
              <p className="mt-0.5 text-xs font-medium text-on-surface-variant japanese-text">
                {description}
              </p>
            )}
          </div>
        </div>
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant">
          <span className="material-symbols-outlined">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </span>
      </button>

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
