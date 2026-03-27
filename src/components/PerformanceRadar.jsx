/**
 * PerformanceRadar — stitch2/stitch (4) 準拠のダイヤモンド型レーダー可視化
 * 純粋CSS実装 (Chart.js不使用)
 */

const AXIS_GROUPS = {
  composition: {
    label: '構成',
    sublabel: 'Composition',
    ids: ['visual_flow', 'information_balance', 'information_density', 'first_view_clarity'],
  },
  design: {
    label: 'デザイン',
    sublabel: 'Design',
    ids: ['visual_impact', 'brand_consistency', 'competitive_edge'],
  },
  cta: {
    label: 'CTA',
    sublabel: '',
    ids: ['cta_effectiveness', 'cta_clarity', 'cta_placement', 'offer_clarity'],
  },
  trust: {
    label: '信頼性',
    sublabel: 'Trustworthiness',
    ids: ['credibility', 'trust_elements', 'drop_off_risk'],
  },
}

const AXIS_ORDER = ['composition', 'design', 'cta', 'trust']

function computeAxes(rubricScores) {
  if (!Array.isArray(rubricScores) || rubricScores.length === 0) return null

  const scoreMap = {}
  rubricScores.forEach((item) => {
    if (item.rubric_id && item.score != null) {
      scoreMap[item.rubric_id] = item.score
    }
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

function ScoreColor({ score }) {
  if (score >= 4) return 'text-emerald-600'
  if (score >= 3) return 'text-amber-600'
  return 'text-rose-500'
}

export default function PerformanceRadar({ rubricScores }) {
  const computed = computeAxes(rubricScores)
  if (!computed) return null

  const { axes, totalScore } = computed

  // Convert axis values (0-5) to percentages (0-100) for polygon positioning
  const topPct = (axes.composition / 5) * 40
  const rightPct = (axes.design / 5) * 40
  const bottomPct = (axes.cta / 5) * 40
  const leftPct = (axes.trust / 5) * 40

  const clipPath = `polygon(50% ${50 - topPct}%, ${50 + rightPct}% 50%, 50% ${50 + bottomPct}%, ${50 - leftPct}% 50%)`

  const totalColor = totalScore >= 80 ? 'bg-emerald-600' : totalScore >= 60 ? 'bg-primary-container' : totalScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] relative overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-black text-xl text-primary tracking-tight mb-1">Performance Radar</h3>
          <p className="text-xs text-on-surface-variant font-medium">4-axis comparative scoring</p>
        </div>
        <div className={`${totalColor} text-white px-4 py-2.5 rounded-xl text-center min-w-[72px]`}>
          <p className="text-[10px] font-medium opacity-80">Total Score</p>
          <p className="text-2xl font-black tabular-nums leading-tight">{totalScore}</p>
        </div>
      </div>

      {/* Main layout: Radar + Score cards side by side */}
      <div className="flex items-start gap-8">
        {/* Diamond Visualization */}
        <div className="relative w-72 h-72 mx-auto flex-shrink-0 flex items-center justify-center">
          {/* Axis Labels with scores */}
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-center">
            <div className={`text-lg font-black tabular-nums ${ScoreColor({ score: axes.composition })}`}>
              {axes.composition.toFixed(1)}
            </div>
            <span className="font-bold text-xs text-on-surface">構成</span>
          </div>
          <div className="absolute top-1/2 -right-16 -translate-y-1/2 text-center">
            <div className={`text-lg font-black tabular-nums ${ScoreColor({ score: axes.design })}`}>
              {axes.design.toFixed(1)}
            </div>
            <span className="font-bold text-xs text-on-surface">デザイン</span>
          </div>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-center">
            <span className="font-bold text-xs text-on-surface">CTA</span>
            <div className={`text-lg font-black tabular-nums ${ScoreColor({ score: axes.cta })}`}>
              {axes.cta.toFixed(1)}
            </div>
          </div>
          <div className="absolute top-1/2 -left-14 -translate-y-1/2 text-center">
            <div className={`text-lg font-black tabular-nums ${ScoreColor({ score: axes.trust })}`}>
              {axes.trust.toFixed(1)}
            </div>
            <span className="font-bold text-xs text-on-surface">信頼性</span>
          </div>

          {/* 3-layer concentric diamond grid */}
          <div className="w-full h-full border border-outline-variant/30 rotate-45 flex items-center justify-center p-8">
            <div className="w-full h-full border border-outline-variant/30 flex items-center justify-center p-8">
              <div className="w-full h-full border border-outline-variant/30" />
            </div>
          </div>

          {/* Data shape overlay */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="w-full h-full bg-[#D4A843]/20 border-2 border-[#D4A843]"
              style={{ clipPath }}
            />
          </div>
        </div>

        {/* Score breakdown cards */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-w-0">
          {AXIS_ORDER.map((key) => {
            const group = AXIS_GROUPS[key]
            const score = axes[key]
            const pct = (score / 5) * 100
            const barColor = score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400'
            return (
              <div key={key} className="bg-surface-container/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-on-surface japanese-text">{group.label}</span>
                  <span className={`text-base font-black tabular-nums ${ScoreColor({ score })}`}>
                    {score.toFixed(1)}<span className="text-on-surface-variant font-normal text-[10px]">/5</span>
                  </span>
                </div>
                <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                {group.sublabel && (
                  <p className="text-[10px] text-on-surface-variant mt-1.5">{group.sublabel}</p>
                )}
              </div>
            )
          })}

          {/* Estimation cards */}
          <div className="bg-surface-container/50 rounded-xl p-4">
            <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Conversion Rate Est.</p>
            <p className="text-base font-black tabular-nums text-primary">—</p>
          </div>
          <div className="bg-surface-container/50 rounded-xl p-4">
            <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Avg. Time on Page</p>
            <p className="text-base font-black tabular-nums text-primary">—</p>
          </div>
        </div>
      </div>
    </div>
  )
}
