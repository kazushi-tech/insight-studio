import { useRef, useEffect } from 'react'
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

export default function ScoreDistributionChart({ discoveries }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !discoveries?.length) return

    const scored = discoveries.filter((d) => d.score != null)
    if (scored.length === 0) return

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    const labels = scored.map((d) => {
      const host = d.domain || (d.url ? new URL(d.url).hostname : '?')
      return host.length > 20 ? host.slice(0, 18) + '…' : host
    })
    const data = scored.map((d) => d.score)
    const colors = scored.map((_, i) => i === 0 ? 'rgba(45, 106, 79, 0.85)' : 'rgba(45, 106, 79, 0.35)')

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Score',
          data,
          backgroundColor: colors,
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { font: { size: 11 } } },
          y: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Score: ${ctx.raw}/100`,
            },
          },
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [discoveries])

  if (!discoveries?.filter((d) => d.score != null).length) return null

  return (
    <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
      <div className="flex items-center gap-2 text-on-surface-variant mb-4">
        <span className="material-symbols-outlined text-secondary text-lg">bar_chart</span>
        <span className="text-sm font-bold">スコア分布</span>
      </div>
      <div style={{ height: Math.max(120, discoveries.filter((d) => d.score != null).length * 40 + 40) }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
