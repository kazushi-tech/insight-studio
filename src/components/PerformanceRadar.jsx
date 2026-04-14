import { useId } from 'react'
import { SCORE_THRESHOLD_EXCELLENT, SCORE_THRESHOLD_GOOD, SCORE_THRESHOLD_FAIR } from '../utils/scoreThresholds'

/**
 * PerformanceRadar — stitch2 準拠ダイヤモンド型レーダー + スコアカード
 * SVG 実装で低スコア時でも形状と軸差分が読み取りやすいようにする
 */

// eslint-disable-next-line react-refresh/only-export-components
export const AXIS_GROUPS_BY_TYPE = {
  banner_review: {
    composition: { label: '構成', ids: ['visual_flow', 'information_balance', 'information_density', 'first_view_clarity'] },
    design:      { label: 'デザイン', ids: ['visual_impact', 'brand_consistency', 'competitive_edge'] },
    cta:         { label: 'CTA', ids: ['cta_effectiveness', 'cta_clarity', 'cta_placement', 'offer_clarity'] },
    trust:       { label: '信頼性', ids: ['credibility', 'trust_elements', 'drop_off_risk'] },
  },
  ad_lp_review: {
    composition: { label: '構成', ids: ['first_view_clarity', 'story_consistency'] },
    message:     { label: 'メッセージ', ids: ['ad_to_lp_message_match', 'benefit_clarity'] },
    cta:         { label: 'CTA', ids: ['cta_placement', 'input_friction'] },
    trust:       { label: '信頼性', ids: ['trust_elements', 'drop_off_risk'] },
  },
}

const AXIS_ORDER_BY_TYPE = {
  banner_review: ['composition', 'design', 'cta', 'trust'],
  ad_lp_review:  ['composition', 'message', 'cta', 'trust'],
}

const AD_LP_IDS = new Set(['ad_to_lp_message_match', 'benefit_clarity', 'input_friction', 'story_consistency'])

function detectReviewType(rubricScores) {
  return rubricScores.some(s => AD_LP_IDS.has(s.rubric_id)) ? 'ad_lp_review' : 'banner_review'
}

const RADAR_GEOMETRY = {
  size: 380,
  center: 190,
  radius: 140,
  levels: [0.25, 0.5, 0.75, 1],
}

const AXIS_META = {
  composition: {
    label: '構成',
    vector: [0, -1],
    labelClassName: 'top-4 left-1/2 -translate-x-1/2 -translate-y-full text-center',
  },
  design: {
    label: 'デザイン',
    vector: [1, 0],
    labelClassName: 'top-1/2 right-4 translate-x-full -translate-y-1/2 text-left',
  },
  message: {
    label: 'メッセージ',
    vector: [1, 0],
    labelClassName: 'top-1/2 right-4 translate-x-full -translate-y-1/2 text-left',
  },
  cta: {
    label: 'CTA',
    vector: [0, 1],
    labelClassName: 'bottom-4 left-1/2 -translate-x-1/2 translate-y-full text-center',
  },
  trust: {
    label: '信頼性',
    vector: [-1, 0],
    labelClassName: 'top-1/2 left-4 -translate-x-full -translate-y-1/2 text-right',
  },
}

function clampScore(score) {
  return Math.max(0, Math.min(5, score ?? 0))
}

function computeAxes(rubricScores, reviewType) {
  if (!Array.isArray(rubricScores) || rubricScores.length === 0) return null

  const type = reviewType || detectReviewType(rubricScores)
  const axisGroups = AXIS_GROUPS_BY_TYPE[type] || AXIS_GROUPS_BY_TYPE.banner_review
  const axisOrder = AXIS_ORDER_BY_TYPE[type] || AXIS_ORDER_BY_TYPE.banner_review

  const scoreMap = {}
  rubricScores.forEach((item) => {
    if (item.rubric_id && item.score != null) scoreMap[item.rubric_id] = item.score
  })

  const axes = {}
  const naAxes = new Set()
  let totalSum = 0
  let totalCount = 0

  for (const key of axisOrder) {
    const group = axisGroups[key]
    const scores = group.ids.map((id) => scoreMap[id]).filter((v) => v != null)
    if (scores.length === 0) {
      axes[key] = 0
      naAxes.add(key)
    } else {
      axes[key] = clampScore(scores.reduce((a, b) => a + b, 0) / scores.length)
      totalSum += scores.reduce((a, b) => a + b, 0)
      totalCount += scores.length
    }
  }

  const totalScore = totalCount > 0 ? Math.round((totalSum / totalCount) * 20) : 0
  return { axes, totalScore, axisOrder, axisGroups, naAxes }
}

function scoreColor(score) {
  if (score >= 4) return 'text-emerald-600'
  if (score >= 3) return 'text-amber-600'
  return 'text-rose-500'
}

function barColor(score) {
  if (score >= 4) return 'bg-emerald-500'
  if (score >= 3) return 'bg-amber-400'
  return 'bg-rose-400'
}

function axisPoint(axisKey, scale = 1) {
  const [dx, dy] = AXIS_META[axisKey].vector
  const radius = RADAR_GEOMETRY.radius * scale

  return {
    x: RADAR_GEOMETRY.center + (dx * radius),
    y: RADAR_GEOMETRY.center + (dy * radius),
  }
}

function diamondPoints(scaleByAxis, axisOrder) {
  return axisOrder.map((axisKey) => {
    const scale = typeof scaleByAxis === 'number'
      ? scaleByAxis
      : clampScore(scaleByAxis[axisKey]) / 5
    const point = axisPoint(axisKey, scale)
    return `${point.x} ${point.y}`
  }).join(' ')
}

export default function PerformanceRadar({ rubricScores, reviewType, compact = false }) {
  const chartId = useId().replace(/:/g, '')
  const computed = computeAxes(rubricScores, reviewType)
  if (!computed) return null

  const { axes, totalScore, axisOrder, axisGroups, naAxes } = computed
  const fillId = `performance-radar-fill-${chartId}`
  const glowId = `performance-radar-glow-${chartId}`
  const totalBg = totalScore >= SCORE_THRESHOLD_EXCELLENT ? 'bg-emerald-600' : totalScore >= SCORE_THRESHOLD_GOOD ? 'bg-primary-container' : totalScore >= SCORE_THRESHOLD_FAIR ? 'bg-amber-500' : 'bg-rose-500'
  const axisEntries = axisOrder.map((key) => ({
    key,
    label: axisGroups[key].label,
    score: axes[key],
    isNA: naAxes.has(key),
  }))
  const scoredEntries = axisEntries.filter((e) => !e.isNA)
  const strongestAxis = scoredEntries.length > 0
    ? scoredEntries.reduce((best, current) => current.score > best.score ? current : best)
    : axisEntries[0]
  const weakestAxis = scoredEntries.length > 0
    ? scoredEntries.reduce((worst, current) => current.score < worst.score ? current : worst)
    : axisEntries[0]
  const radarPolygonPoints = diamondPoints(axes, axisOrder)

  return (
    <div className={`bg-surface-container-lowest rounded-[0.75rem] border border-outline-variant/15 ${compact ? 'p-3 md:p-4' : 'p-6 md:p-8'} panel-card-hover`}>
      {/* Header */}
      {compact ? (
        <div className="flex items-center justify-center">
          <div className={`${totalBg} text-white px-3 py-2 rounded-[0.75rem] text-center min-w-[72px] shadow-sm`}>
            <p className="text-[10px] font-medium opacity-80">Score</p>
            <p className="text-2xl font-black tabular-nums leading-none">{totalScore}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-black text-xl text-primary tracking-tight mb-1">Performance Radar</h3>
            <p className="text-xs text-on-surface-variant font-medium">4-axis comparative scoring</p>
          </div>
          <div className={`${totalBg} text-white px-4 py-3 rounded-[0.75rem] text-center min-w-[92px] shadow-sm`}>
            <p className="text-xs font-medium opacity-80">Total Score</p>
            <p className="text-3xl font-black tabular-nums leading-none">{totalScore}</p>
            <p className="text-xs font-bold opacity-70 mt-1">out of 100</p>
          </div>
        </div>
      )}

      {/* Diamond */}
      <div className={compact ? 'mt-4' : 'mt-10'}>
        <div className={`relative mx-auto w-full ${compact ? 'max-w-[20rem]' : 'max-w-[32rem]'} aspect-square`}>
          <div
            className="absolute inset-12 rounded-full blur-3xl pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(45, 106, 79, 0.18) 0%, rgba(45, 106, 79, 0) 72%)' }}
          />
          <svg
            viewBox={`0 0 ${RADAR_GEOMETRY.size} ${RADAR_GEOMETRY.size}`}
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={fillId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--color-secondary-fixed-dim)" stopOpacity="0.48" />
                <stop offset="100%" stopColor="var(--color-primary-container)" stopOpacity="0.16" />
              </linearGradient>
              <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="var(--color-primary-container)" floodOpacity="0.18" />
              </filter>
            </defs>

            <polygon
              points={diamondPoints(1, axisOrder)}
              fill="var(--color-secondary-fixed-dim)"
              opacity="0.04"
            />

            {RADAR_GEOMETRY.levels.map((level) => (
              <polygon
                key={level}
                points={diamondPoints(level, axisOrder)}
                fill="none"
                stroke="var(--color-outline-variant)"
                strokeWidth={level === 1 ? 1.5 : 1}
                opacity={level === 1 ? 0.55 : 0.40}
              />
            ))}

            {axisOrder.map((axisKey) => {
              const outerPoint = axisPoint(axisKey, 1)
              const currentPoint = axisPoint(axisKey, clampScore(axes[axisKey]) / 5)
              const isNA = naAxes.has(axisKey)

              return (
                <g key={axisKey}>
                  <line
                    x1={RADAR_GEOMETRY.center}
                    y1={RADAR_GEOMETRY.center}
                    x2={outerPoint.x}
                    y2={outerPoint.y}
                    stroke="var(--color-outline-variant)"
                    strokeWidth="1"
                    opacity="0.40"
                    strokeDasharray={isNA ? '4 3' : undefined}
                  />
                  {!isNA && (
                    <line
                      x1={RADAR_GEOMETRY.center}
                      y1={RADAR_GEOMETRY.center}
                      x2={currentPoint.x}
                      y2={currentPoint.y}
                      stroke="var(--color-primary-container)"
                      strokeWidth="2"
                      opacity="0.38"
                    />
                  )}
                </g>
              )
            })}

            <circle
              cx={RADAR_GEOMETRY.center}
              cy={RADAR_GEOMETRY.center}
              r="28"
              fill="var(--color-secondary-fixed-dim)"
              opacity="0.08"
            />

            <polygon
              points={radarPolygonPoints}
              fill={`url(#${fillId})`}
              stroke="var(--color-primary-container)"
              strokeWidth="2.75"
              strokeLinejoin="round"
              filter={`url(#${glowId})`}
            />

            {axisOrder.map((axisKey) => {
              const point = axisPoint(axisKey, clampScore(axes[axisKey]) / 5)

              return (
                <g key={`${axisKey}-marker`}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="5.5"
                    fill="var(--color-surface-container-lowest)"
                    stroke="var(--color-primary-container)"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="2.4"
                    fill="var(--color-primary-container)"
                  />
                </g>
              )
            })}

            <circle
              cx={RADAR_GEOMETRY.center}
              cy={RADAR_GEOMETRY.center}
              r="4.5"
              fill="var(--color-primary-container)"
              opacity="0.9"
            />
          </svg>

          {axisOrder.map((axisKey) => {
            const meta = AXIS_META[axisKey]
            const score = axes[axisKey]
            const isNA = naAxes.has(axisKey)

            return (
              <div key={axisKey} className={`absolute ${meta.labelClassName} pointer-events-none`}>
                <p className="text-xs font-black tracking-[0.16em] text-on-surface-variant/75 uppercase whitespace-nowrap">
                  {meta.label}
                </p>
                {isNA ? (
                  <p className={`${compact ? 'text-lg' : 'text-[1.75rem] md:text-4xl'} font-black tabular-nums leading-none whitespace-nowrap text-on-surface-variant/50`}>
                    N/A
                  </p>
                ) : (
                  <p className={`${compact ? 'text-lg' : 'text-[1.75rem] md:text-4xl'} font-black tabular-nums leading-none whitespace-nowrap ${scoreColor(score)}`}>
                    {score.toFixed(1)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Score breakdown grid */}
      {!compact && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-10">
        {axisOrder.map((key) => {
          const group = axisGroups[key]
          const score = axes[key]
          const isNA = naAxes.has(key)
          const pct = isNA ? 0 : (score / 5) * 100
          return (
            <div key={key} className={`bg-surface-container/45 border border-outline-variant/10 rounded-[0.75rem] p-4 ${isNA ? 'opacity-60' : ''}`}>
              <p className="text-xs font-bold text-on-surface japanese-text">{group.label}</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                {isNA ? (
                  <p className="text-3xl font-black tabular-nums leading-none text-on-surface-variant/50">N/A</p>
                ) : (
                  <p className={`text-3xl font-black tabular-nums leading-none ${scoreColor(score)}`}>
                    {score.toFixed(1)}
                    <span className="text-on-surface-variant font-medium text-xs ml-0.5">/5</span>
                  </p>
                )}
                {!isNA && <span className="text-sm font-bold text-on-surface-variant tabular-nums">{Math.round(pct)}%</span>}
              </div>
              <div className="h-2 bg-surface-container-high rounded-full overflow-hidden mt-3">
                {isNA ? (
                  <div className="h-full w-full rounded-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-outline-variant) 0px, var(--color-outline-variant) 4px, transparent 4px, transparent 7px)', opacity: 0.4 }} />
                ) : (
                  <div className={`h-full ${barColor(score)} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                )}
              </div>
            </div>
          )
        })}
      </div>}

      {/* Derived summary */}
      {!compact && <div className="grid gap-3 mt-3 sm:grid-cols-2">
        <div className="bg-surface-container/45 border border-outline-variant/10 rounded-[0.75rem] p-4">
          <p className="text-xs font-bold text-on-surface-variant mb-2 uppercase tracking-[0.16em]">Strongest Axis</p>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-base font-black text-primary japanese-text">{strongestAxis.label}</p>
              <p className="text-xs text-on-surface-variant">現状で最も機能している評価軸</p>
            </div>
            <p className={`text-2xl font-black tabular-nums whitespace-nowrap ${scoreColor(strongestAxis.score)}`}>
              {strongestAxis.score.toFixed(1)}
              <span className="text-on-surface-variant font-medium text-xs ml-0.5">/5</span>
            </p>
          </div>
        </div>
        <div className="bg-surface-container/45 border border-outline-variant/10 rounded-[0.75rem] p-4">
          <p className="text-xs font-bold text-on-surface-variant mb-2 uppercase tracking-[0.16em]">Needs Attention</p>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-base font-black text-primary japanese-text">{weakestAxis.label}</p>
              <p className="text-xs text-on-surface-variant">改善優先度が最も高い評価軸</p>
            </div>
            <p className={`text-2xl font-black tabular-nums whitespace-nowrap ${scoreColor(weakestAxis.score)}`}>
              {weakestAxis.score.toFixed(1)}
              <span className="text-on-surface-variant font-medium text-xs ml-0.5">/5</span>
            </p>
          </div>
        </div>
      </div>}
    </div>
  )
}
