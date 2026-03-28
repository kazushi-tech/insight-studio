/**
 * PerformanceRadar — stitch2 準拠ダイヤモンド型レーダー + スコアカード
 * 純粋CSS実装 (Chart.js不使用)
 */

const AXIS_GROUPS = {
  composition: {
    label: '構成',
    ids: ['visual_flow', 'information_balance', 'information_density', 'first_view_clarity'],
  },
  design: {
    label: 'デザイン',
    ids: ['visual_impact', 'brand_consistency', 'competitive_edge'],
  },
  cta: {
    label: 'CTA',
    ids: ['cta_effectiveness', 'cta_clarity', 'cta_placement', 'offer_clarity'],
  },
  trust: {
    label: '信頼性',
    ids: ['credibility', 'trust_elements', 'drop_off_risk'],
  },
}

const AXIS_ORDER = ['composition', 'design', 'cta', 'trust']

function computeAxes(rubricScores) {
  if (!Array.isArray(rubricScores) || rubricScores.length === 0) return null

  const scoreMap = {}
  rubricScores.forEach((item) => {
    if (item.rubric_id && item.score != null) scoreMap[item.rubric_id] = item.score
  })

  const axes = {}
  let totalSum = 0
  let totalCount = 0

  for (const key of AXIS_ORDER) {
    const group = AXIS_GROUPS[key]
    const scores = group.ids.map((id) => scoreMap[id]).filter((v) => v != null)
    axes[key] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    totalSum += scores.reduce((a, b) => a + b, 0)
    totalCount += scores.length
  }

  const totalScore = totalCount > 0 ? Math.round((totalSum / totalCount) * 20) : 0
  return { axes, totalScore }
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

export default function PerformanceRadar({ rubricScores }) {
  const computed = computeAxes(rubricScores)
  if (!computed) return null

  const { axes, totalScore } = computed

  const topPct = (axes.composition / 5) * 40
  const rightPct = (axes.design / 5) * 40
  const bottomPct = (axes.cta / 5) * 40
  const leftPct = (axes.trust / 5) * 40

  const clipPath = `polygon(50% ${50 - topPct}%, ${50 + rightPct}% 50%, 50% ${50 + bottomPct}%, ${50 - leftPct}% 50%)`
  const totalBg = totalScore >= 80 ? 'bg-emerald-600' : totalScore >= 60 ? 'bg-primary-container' : totalScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="bg-surface-container-lowest p-8 rounded-[0.75rem] panel-card-hover">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="font-black text-xl text-primary tracking-tight mb-1">Performance Radar</h3>
          <p className="text-xs text-on-surface-variant font-medium">4-axis comparative scoring</p>
        </div>
        <div className={`${totalBg} text-white px-4 py-2.5 rounded-[0.75rem] text-center min-w-[72px]`}>
          <p className="text-[10px] font-medium opacity-80">Total Score</p>
          <p className="text-2xl font-black tabular-nums leading-tight">{totalScore}</p>
        </div>
      </div>

      {/* Diamond — centered, generous spacing */}
      <div className="relative w-56 h-56 mx-auto my-12 flex items-center justify-center">
        {/* Top: 構成 */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-center whitespace-nowrap">
          <span className={`text-xl font-black tabular-nums ${scoreColor(axes.composition)}`}>{axes.composition.toFixed(1)}</span>
          <p className="text-[11px] font-bold text-on-surface mt-0.5">構成</p>
        </div>
        {/* Right: デザイン */}
        <div className="absolute top-1/2 -right-20 -translate-y-1/2 text-center whitespace-nowrap">
          <span className={`text-xl font-black tabular-nums ${scoreColor(axes.design)}`}>{axes.design.toFixed(1)}</span>
          <p className="text-[11px] font-bold text-on-surface mt-0.5">デザイン</p>
        </div>
        {/* Bottom: CTA */}
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-center whitespace-nowrap">
          <p className="text-[11px] font-bold text-on-surface mb-0.5">CTA</p>
          <span className={`text-xl font-black tabular-nums ${scoreColor(axes.cta)}`}>{axes.cta.toFixed(1)}</span>
        </div>
        {/* Left: 信頼性 */}
        <div className="absolute top-1/2 -left-20 -translate-y-1/2 text-center whitespace-nowrap">
          <span className={`text-xl font-black tabular-nums ${scoreColor(axes.trust)}`}>{axes.trust.toFixed(1)}</span>
          <p className="text-[11px] font-bold text-on-surface mt-0.5">信頼性</p>
        </div>

        {/* 3-layer concentric diamond grid */}
        <div className="w-full h-full border border-outline-variant/30 rotate-45 flex items-center justify-center p-7">
          <div className="w-full h-full border border-outline-variant/30 flex items-center justify-center p-7">
            <div className="w-full h-full border border-outline-variant/30" />
          </div>
        </div>

        {/* Data shape */}
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <div
            className="w-full h-full bg-[#D4A843]/20 border-2 border-[#D4A843]"
            style={{ clipPath }}
          />
        </div>
      </div>

      {/* Score breakdown grid */}
      <div className="grid grid-cols-4 gap-3 mt-4">
        {AXIS_ORDER.map((key) => {
          const group = AXIS_GROUPS[key]
          const score = axes[key]
          const pct = (score / 5) * 100
          return (
            <div key={key} className="bg-surface-container/50 rounded-[0.75rem] p-4 text-center">
              <p className="text-xs font-bold text-on-surface japanese-text mb-2">{group.label}</p>
              <p className={`text-2xl font-black tabular-nums ${scoreColor(score)}`}>
                {score.toFixed(1)}
                <span className="text-on-surface-variant font-normal text-xs">/5</span>
              </p>
              <div className="h-1.5 bg-surface-container rounded-full overflow-hidden mt-2">
                <div className={`h-full ${barColor(score)} rounded-full transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Estimation metrics */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="bg-surface-container/50 rounded-[0.75rem] p-4">
          <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Conversion Rate Est.</p>
          <p className="text-base font-black tabular-nums text-primary">—</p>
        </div>
        <div className="bg-surface-container/50 rounded-[0.75rem] p-4">
          <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Avg. Time on Page</p>
          <p className="text-base font-black tabular-nums text-primary">—</p>
        </div>
      </div>
    </div>
  )
}
