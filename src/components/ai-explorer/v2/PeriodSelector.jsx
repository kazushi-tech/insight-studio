import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './AiExplorerV2.module.css'

/**
 * PeriodSelector — display/stub period chip for Phase 1. Clicking the trigger
 * reveals a popover with preset shortcuts (left) and a simple two-month
 * calendar preview (right). The actual "apply" handler is optional in Phase 1;
 * backend period wiring ships in a later phase.
 *
 * Props:
 *   - analysisRun: optional { periodLabel?: string } used to seed the trigger.
 *   - onApply: optional callback receiving { preset, start, end }. When
 *     omitted, the Apply button is display-only.
 */

const PRESETS = [
  { key: 'last7', label: '過去7日', days: 7 },
  { key: 'last30', label: '過去30日', days: 30, default: true },
  { key: 'last90', label: '過去90日', days: 90 },
  { key: 'quarter', label: '今四半期', quarter: true },
  { key: 'custom', label: 'カスタム', custom: true },
]

const DAY_HEADERS = ['日', '月', '火', '水', '木', '金', '土']

function presetRange(preset) {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)

  if (preset.quarter) {
    const month = end.getMonth()
    const quarterStartMonth = Math.floor(month / 3) * 3
    start.setMonth(quarterStartMonth, 1)
    start.setHours(0, 0, 0, 0)
    return { start, end }
  }

  if (preset.custom) {
    start.setDate(end.getDate() - 30)
    start.setHours(0, 0, 0, 0)
    return { start, end }
  }

  start.setDate(end.getDate() - (preset.days - 1))
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function formatMonthHeader(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function formatDateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function buildMonthCells(refDate) {
  const year = refDate.getFullYear()
  const month = refDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const startWeekday = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ key: `pad-${i}`, day: null })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: `d-${d}`, day: d })
  }
  return cells
}

export default function PeriodSelector({ analysisRun, onApply }) {
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState('last30')
  const wrapRef = useRef(null)

  const activePreset = useMemo(
    () => PRESETS.find((p) => p.key === activeKey) ?? PRESETS[1],
    [activeKey],
  )

  const currentRange = useMemo(() => presetRange(activePreset), [activePreset])

  const triggerLabel = useMemo(() => {
    if (analysisRun?.periodLabel) return analysisRun.periodLabel
    return activePreset.label
  }, [analysisRun, activePreset])

  useEffect(() => {
    if (!open) return undefined
    const handleClick = (event) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const monthA = new Date()
  const monthB = new Date(monthA.getFullYear(), monthA.getMonth() - 1, 1)

  const handleApply = () => {
    if (typeof onApply === 'function') {
      onApply({ preset: activeKey, start: currentRange.start, end: currentRange.end })
    }
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={styles.periodTrigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="期間を選択"
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
          date_range
        </span>
        <span className="japanese-text">{triggerLabel}</span>
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
          expand_more
        </span>
      </button>

      {open && (
        <div
          className={styles.periodSelector}
          role="dialog"
          aria-label="期間選択"
          data-testid="period-selector-popover"
        >
          <div className={styles.periodSelectorInner}>
            <div className={styles.periodPresetList}>
              {PRESETS.map((preset) => {
                const active = preset.key === activeKey
                return (
                  <button
                    key={preset.key}
                    type="button"
                    className={`${styles.periodPresetButton} ${active ? styles.periodPresetButtonActive : ''}`}
                    onClick={() => setActiveKey(preset.key)}
                    aria-pressed={active}
                  >
                    <span className="japanese-text">{preset.label}</span>
                    {active && (
                      <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
                        check
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className={styles.periodCalendar}>
              {[monthB, monthA].map((month) => (
                <div key={`${month.getFullYear()}-${month.getMonth()}`}>
                  <div className={`${styles.periodCalendarHeader} japanese-text`}>
                    {formatMonthHeader(month)}
                  </div>
                  <div className={styles.periodCalendarGrid} role="grid">
                    {DAY_HEADERS.map((d) => (
                      <div key={`h-${d}`} className={styles.periodCalendarDay}>
                        {d}
                      </div>
                    ))}
                    {buildMonthCells(month).map((cell) => (
                      <div
                        key={cell.key}
                        className={`${styles.periodCalendarCell} ${cell.day == null ? styles.periodCalendarCellMuted : ''}`}
                      >
                        {cell.day ?? ''}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.periodFooter}>
            <span className={`${styles.periodFooterLabel} japanese-text`}>
              選択中: {activePreset.label}（{formatDateLabel(currentRange.start)} –{' '}
              {formatDateLabel(currentRange.end)}）
            </span>
            <button type="button" className={styles.periodApplyButton} onClick={handleApply}>
              <span className="japanese-text">この期間で適用</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
