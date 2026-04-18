import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart, RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js'
import { REPORT_COLORS, applyChartDefaults } from './reportTheme'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

/**
 * Radar chart visualizing per-brand scores across the 6 evaluation axes.
 *
 * Verdicts are mapped to 0.0 / 0.5 / 1.0 so shapes can be compared at a glance.
 * 評価保留 is treated as a gap in the polygon (skipped via null).
 */

const AXIS_KEYS = ['検索意図一致', 'FV訴求', 'CTA明確性', '信頼構築', '価格・オファー', '購買導線']

const VERDICT_SCORE = {
  強: 1.0,
  同等: 0.5,
  弱: 0.0,
  評価保留: null,
}

function findBrandSectionBodies(reportMd) {
  if (typeof reportMd !== 'string') return []
  const sectionMatch = reportMd.match(/##\s*(?:\d+[.．]?\s*)?ブランド別評価[^\n]*/)
  if (!sectionMatch) return []
  const start = sectionMatch.index + sectionMatch[0].length
  const rest = reportMd.slice(start)
  const endMatch = rest.match(/\n##\s/)
  const end = endMatch ? endMatch.index : rest.length
  const sectionBody = rest.slice(0, end)
  const chunks = sectionBody.split(/\n###\s+/)
  return chunks.slice(1).map((chunk) => {
    const [first, ...lines] = chunk.split('\n')
    return { title: first.trim(), body: lines.join('\n') }
  })
}

function parseBrandScores(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (lines.length < 3) return null
  const header = lines[0].split('|').map((c) => c.trim()).filter(Boolean)
  const axisIdx = header.findIndex((h) => /評価軸/.test(h))
  const verdictIdx = header.findIndex((h) => /判定/.test(h))
  if (axisIdx === -1 || verdictIdx === -1) return null

  const scores = {}
  for (const line of lines.slice(2)) {
    const cells = line.split('|').map((c) => c.trim())
    const offset = 1
    const axis = cells[axisIdx + offset]
    const verdictRaw = cells[verdictIdx + offset] || ''
    if (!axis) continue
    const verdictMatch = verdictRaw.match(/強|同等|弱|評価保留/)
    const normalizedAxis = AXIS_KEYS.find((k) => axis.includes(k) || k.includes(axis.replace(/[・\s]/g, '')))
    if (!normalizedAxis) continue
    const verdict = verdictMatch ? verdictMatch[0] : '評価保留'
    scores[normalizedAxis] = VERDICT_SCORE[verdict]
  }
  return Object.keys(scores).length > 0 ? scores : null
}

function parseRadarData(reportMd) {
  const chunks = findBrandSectionBodies(reportMd)
  const brands = []
  for (const c of chunks) {
    const scores = parseBrandScores(c.body)
    if (!scores) continue
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
