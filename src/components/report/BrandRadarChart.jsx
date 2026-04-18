import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js'
import { REPORT_COLORS, applyChartDefaults } from './reportTheme'
import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../../utils/brandEvalParser'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

/**
 * Radar chart visualizing per-brand scores across the 6 evaluation axes.
 *
 * Verdicts are mapped to 0.0 / 0.5 / 1.0 so shapes can be compared at a glance.
 * 評価保留 is treated as a gap in the polygon (skipped via null).
 */

const VERDICT_SCORE = {
  強: 1.0,
  同等: 0.5,
  弱: 0.0,
  評価保留: null,
}

function parseRadarData(reportMd) {
  const chunks = findBrandSectionBodies(reportMd)
  const brands = []
  for (const c of chunks) {
    const verdicts = parseBrandVerdicts(c.body)
    if (!verdicts) continue
    const scores = {}
    for (const [axis, cell] of Object.entries(verdicts)) {
      const verdict = cell.verdict ?? '評価保留'
      scores[axis] = VERDICT_SCORE[verdict] ?? null
    }
    if (Object.keys(scores).length === 0) continue
    brands.push({ brand: c.title, scores })
  }
  return brands
}

const BRAND_PALETTE = [
  { border: '#003925', bg: 'rgba(0, 57, 37, 0.18)' },
  { border: '#D4A843', bg: 'rgba(212, 168, 67, 0.18)' },
  { border: '#ba1a1a', bg: 'rgba(186, 26, 26, 0.15)' },
  { border: '#0f5238', bg: 'rgba(15, 82, 56, 0.15)' },
  { border: '#78350f', bg: 'rgba(120, 53, 15, 0.15)' },
  { border: '#374151', bg: 'rgba(55, 65, 81, 0.15)' },
]

export default function BrandRadarChart({ reportMd }) {
  const brands = useMemo(() => parseRadarData(reportMd), [reportMd])
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const [mode, setMode] = useState('all')

  useEffect(() => {
    applyChartDefaults(Chart)
  }, [])

  useEffect(() => {
    if (!brands.length || !canvasRef.current) return
    const visible = mode === 'all' ? brands : brands.filter((b) => b.brand === mode)
    const datasets = visible.map((b, i) => {
      const color = BRAND_PALETTE[i % BRAND_PALETTE.length]
      return {
        label: b.brand,
        data: AXIS_KEYS.map((k) => (b.scores[k] == null ? null : b.scores[k])),
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2,
        pointBackgroundColor: color.border,
        pointRadius: 3,
        pointHoverRadius: 5,
        spanGaps: true,
      }
    })

    if (chartRef.current) {
      chartRef.current.data = { labels: AXIS_KEYS, datasets }
      chartRef.current.update()
      return
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: 'radar',
      data: { labels: AXIS_KEYS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: 1,
            ticks: {
              stepSize: 0.5,
              backdropColor: 'transparent',
              callback: (v) => (v === 1 ? '強' : v === 0.5 ? '同等' : v === 0 ? '弱' : ''),
              color: REPORT_COLORS.outline,
              font: { size: 10 },
            },
            grid: { color: REPORT_COLORS.outlineVariant },
            angleLines: { color: REPORT_COLORS.outlineVariant },
            pointLabels: {
              color: '#1a1c19',
              font: { size: 12, weight: '600' },
            },
          },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.r
                const label = v === 1 ? '強' : v === 0.5 ? '同等' : v === 0 ? '弱' : '評価保留'
                return `${ctx.dataset.label}: ${label}`
              },
            },
          },
        },
      },
    })
  }, [brands, mode])

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [])

  if (!brands.length) return null

  return (
    <section
      className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15 print:break-inside-avoid"
      aria-label="ブランド別レーダーチャート"
    >
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px' }}>
            radar
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant">
            ブランド別レーダー
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap print:hidden">
          <button
            type="button"
            onClick={() => setMode('all')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
              mode === 'all'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            全て
          </button>
          {brands.map((b) => (
            <button
              key={b.brand}
              type="button"
              onClick={() => setMode(b.brand)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold max-w-[10rem] truncate transition-colors ${
                mode === b.brand
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
              title={b.brand}
            >
              {b.brand}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-[360px]">
        <canvas ref={canvasRef} aria-label="ブランド別評価レーダーチャート" />
      </div>
    </section>
  )
}
