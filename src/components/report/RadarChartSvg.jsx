import { useId } from 'react'

const SIZE = 360
const CENTER = SIZE / 2
const RADIUS = 118
const LEVELS = [0.5, 1]

function pointFor(index, total, value = 1) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total
  return {
    x: CENTER + Math.cos(angle) * RADIUS * value,
    y: CENTER + Math.sin(angle) * RADIUS * value,
  }
}

function pointsFor(values) {
  const total = values.length
  return values
    .map((value, index) => {
      if (value == null) return null
      const point = pointFor(index, total, Math.max(0, Math.min(1, Number(value))))
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
}

function verdictLabel(value) {
  if (value == null) return '評価保留'
  if (value >= 1) return '強'
  if (value >= 0.5) return '同等'
  return '弱'
}

/**
 * Dependency-free, non-animated radar chart used by both report generations.
 * Missing values stay missing: they are excluded from the polygon and exposed
 * as "評価保留" in the accessible value list instead of being plotted at zero.
 */
export default function RadarChartSvg({ axes, series, label = 'ブランド別評価レーダーチャート' }) {
  const titleId = useId()
  const descriptionId = useId()
  const total = axes.length

  if (!total || !series?.length) return null

  const gridPolygons = LEVELS.map((level) =>
    axes
      .map((_, index) => {
        const point = pointFor(index, total, level)
        return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
      })
      .join(' ')
  )

  return (
    <div className="h-full w-full min-h-[18rem]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>{label}</title>
        <desc id={descriptionId}>中心から外側へ、弱、同等、強の順で評価を示します。評価保留は線に含めません。</desc>

        <g aria-hidden="true">
          {gridPolygons.map((points, index) => (
            <polygon
              key={LEVELS[index]}
              points={points}
              fill={index === LEVELS.length - 1 ? 'var(--md-sys-color-surface-container-low, #f4f4ef)' : 'none'}
              stroke="var(--md-sys-color-outline-variant, #bfc9c1)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {axes.map((_, index) => {
            const edge = pointFor(index, total)
            return (
              <line
                key={index}
                x1={CENTER}
                y1={CENTER}
                x2={edge.x}
                y2={edge.y}
                stroke="var(--md-sys-color-outline-variant, #bfc9c1)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

          {series.map((item) => {
            const points = pointsFor(item.values)
            const knownCount = item.values.filter((value) => value != null).length
            return (
              <g key={item.name} opacity={item.dimmed ? 0.32 : 1}>
                {knownCount >= 3 && (
                  <polygon
                    points={points}
                    fill={item.fill}
                    stroke={item.stroke}
                    strokeWidth={item.emphasized === false ? 1 : 2}
                    strokeDasharray={item.dashed ? '6 5' : undefined}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {item.values.map((value, index) => {
                  if (value == null) return null
                  const point = pointFor(index, total, value)
                  return (
                    <circle
                      key={axes[index]}
                      cx={point.x}
                      cy={point.y}
                      r={item.emphasized === false ? 2 : 3.5}
                      fill={item.stroke}
                      stroke="var(--md-sys-color-surface-container-lowest, #fff)"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              </g>
            )
          })}

          {axes.map((axis, index) => {
            const point = pointFor(index, total, 1.28)
            const anchor = Math.abs(point.x - CENTER) < 8 ? 'middle' : point.x < CENTER ? 'end' : 'start'
            const text = axis.length > 7 ? `${axis.slice(0, 6)}…` : axis
            return (
              <text
                key={axis}
                x={point.x}
                y={point.y}
                textAnchor={anchor}
                dominantBaseline="middle"
                fill="var(--md-sys-color-on-surface, #1a1c19)"
                fontSize="11"
                fontWeight="700"
                fontFamily="Manrope, 'Noto Sans JP', system-ui, sans-serif"
              >
                {text}
              </text>
            )
          })}
        </g>
      </svg>

      <ul className="sr-only">
        {series.map((item) => (
          <li key={item.name}>
            {item.name}: {axes.map((axis, index) => `${axis}は${verdictLabel(item.values[index])}`).join('、')}
          </li>
        ))}
      </ul>
    </div>
  )
}
