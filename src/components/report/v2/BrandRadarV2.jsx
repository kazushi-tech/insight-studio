import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ThemeContext } from '../../../contexts/ThemeContext'
import {
  Chart,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import {
  applyChartDefaultsV2,
  restoreChartDefaultsV2,
  BRAND_PALETTE_V2,
  getActiveColorsV2,
} from './reportThemeV2'
import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../../../utils/brandEvalParser'
import styles from './BrandRadarV2.module.css'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const VERDICT_SCORE = {
  強: 1.0,
  同等: 0.5,
  弱: 0.0,
  評価保留: null,
}

function fromEnvelope(evaluations) {
  if (!Array.isArray(evaluations) || evaluations.length === 0) return []
  return evaluations
    .map((e) => {
      const scores = {}
      for (const a of e.axes || []) {
        if (!AXIS_KEYS.includes(a.axis)) continue
        scores[a.axis] = VERDICT_SCORE[a.verdict] ?? null
      }
      return Object.keys(scores).length ? { brand: e.brand, scores } : null
    })
    .filter(Boolean)
}

function fromMd(reportMd) {
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

export default function BrandRadarV2({ envelope, reportMd }) {
  const brands = useMemo(() => {
    const envBrands = fromEnvelope(envelope?.brand_evaluations)
    return envBrands.length > 0 ? envBrands : fromMd(reportMd)
  }, [envelope, reportMd])

  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const [mode, setMode] = useState('all')
  const isDark = useContext(ThemeContext)?.isDark ?? false

  useEffect(() => {
    applyChartDefaultsV2(Chart)
    return () => restoreChartDefaultsV2(Chart)
  }, [])

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }
    restoreChartDefaultsV2(Chart)
    applyChartDefaultsV2(Chart)
  }, [isDark])

  useEffect(() => {
    if (!brands.length || !canvasRef.current) return
    const c = getActiveColorsV2()
    const datasets = brands.map((b, i) => {
      const color = BRAND_PALETTE_V2[i % BRAND_PALETTE_V2.length]
      const isFocused = mode === 'all' || mode === b.brand
      // Extract rgba fill alpha so we can dim unfocused brands cleanly.
      const dimBg = color.bg.replace(
        /rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/,
        'rgba($1,$2,$3, 0.06)'
      )
      const dimBorder = isFocused ? color.border : `${color.border}33`
      return {
        label: b.brand,
        data: AXIS_KEYS.map((k) => (b.scores[k] == null ? null : b.scores[k])),
        borderColor: dimBorder,
        backgroundColor: isFocused ? color.bg : dimBg,
        borderWidth: isFocused ? 2 : 1,
        pointBackgroundColor: dimBorder,
        pointRadius: isFocused ? 3 : 1,
        pointHoverRadius: isFocused ? 6 : 3,
        spanGaps: true,
        order: isFocused ? 1 : 2,
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
              color: c.outline,
              font: { size: 10 },
            },
            grid: { color: c.outlineVariant },
            angleLines: { color: c.outlineVariant },
            pointLabels: {
              color: c.onSurface,
              font: (ctx) => {
                const w = ctx.chart?.width ?? 0
                return { size: w < 420 ? 10 : 12, weight: '600' }
              },
              callback: (label) =>
                typeof label === 'string' && label.length > 6 ? label.slice(0, 5) + '…' : label,
            },
          },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items?.[0]?.dataIndex
                return idx != null ? AXIS_KEYS[idx] : ''
              },
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
  }, [brands, mode, isDark])

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
      className={`${styles.panel} md-v2-enter`}
      aria-label="ブランド別レーダー"
      data-testid="brand-radar-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Brand Radar — 6軸評価</span>
        <div className={styles.toggleGroup} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'all'}
            onClick={() => setMode('all')}
            className={`${styles.toggle} ${mode === 'all' ? styles.toggleActive : ''}`}
          >
            全て
          </button>
          {brands.map((b) => (
            <button
              key={b.brand}
              type="button"
              role="tab"
              aria-selected={mode === b.brand}
              onClick={() => setMode(b.brand)}
              className={`${styles.toggle} ${mode === b.brand ? styles.toggleActive : ''}`}
              title={b.brand}
            >
              {b.brand}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} aria-label="ブランド別評価レーダーチャート" />
      </div>
    </section>
  )
}
