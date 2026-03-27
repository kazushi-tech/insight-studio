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

export default function PerformanceRadar({ rubricScores }) {
  const computed = computeAxes(rubricScores)
  if (!computed) return null

  const { axes, totalScore } = computed

  // Convert axis values (0-5) to percentages (0-100) for polygon positioning
  // top = composition, right = design, bottom = cta, left = trust
  const topPct = (axes.composition / 5) * 40     // max 40% from center
  const rightPct = (axes.design / 5) * 40
  const bottomPct = (axes.cta / 5) * 40
  const leftPct = (axes.trust / 5) * 40

  const clipPath = `polygon(50% ${50 - topPct}%, ${50 + rightPct}% 50%, 50% ${50 + bottomPct}%, ${50 - leftPct}% 50%)`

  return (
    <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] relative overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h3 className="font-black text-xl text-primary tracking-tight mb-1">Performance Radar</h3>
          <p className="text-xs text-on-surface-variant font-medium">4-axis comparative scoring</p>
        </div>
        <div className="bg-primary-container text-white px-3 py-2 rounded-lg text-center min-w-[60px]">
          <p className="text-[10px] font-medium opacity-70">Total Score</p>
          <p className="text-xl font-black tabular-nums">{totalScore}</p>
        </div>
      </div>

      {/* Diamond Visualization */}
      <div className="relative w-64 h-64 mx-auto mb-6 flex items-center justify-center">
        {/* Axis Labels */}
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-center">
          <span className="font-bold text-xs text-on-surface">
            {AXIS_GROUPS.composition.label}
          </span>
          <span className="text-[10px] text-on-surface-variant ml-1">
            ({AXIS_GROUPS.composition.sublabel})
          </span>
        </div>
        <div className="absolute top-1/2 -right-12 -translate-y-1/2 text-center">
          <span className="font-bold text-xs text-on-surface">
            {AXIS_GROUPS.design.label}
          </span>
          <span className="text-[10px] text-on-surface-variant ml-1">
            ({AXIS_GROUPS.design.sublabel})
          </span>
        </div>
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 font-bold text-xs text-on-surface">
          {AXIS_GROUPS.cta.label}
        </div>
        <div className="absolute top-1/2 -left-12 -translate-y-1/2 text-center">
          <span className="font-bold text-xs text-on-surface">
            {AXIS_GROUPS.trust.label}
          </span>
          <span className="text-[10px] text-on-surface-variant ml-1">
            ({AXIS_GROUPS.trust.sublabel})
          </span>
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

        {/* Axis score badges */}
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full text-[10px] font-black text-secondary tabular-nums mt-[-4px]">
          {axes.composition.toFixed(1)}
        </div>
        <div className="absolute top-1/2 -right-1 translate-x-full -translate-y-1/2 text-[10px] font-black text-secondary tabular-nums ml-1">
          {axes.design.toFixed(1)}
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full text-[10px] font-black text-secondary tabular-nums mt-1">
          {axes.cta.toFixed(1)}
        </div>
        <div className="absolute top-1/2 -left-1 -translate-x-full -translate-y-1/2 text-[10px] font-black text-secondary tabular-nums mr-1">
          {axes.trust.toFixed(1)}
        </div>
      </div>

      {/* Bottom metric cards */}
      <div className="grid grid-cols-2 gap-4 mt-8">
        <div className="bg-surface p-3 rounded-xl">
          <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Conversion rate est.</p>
          <p className="text-lg font-black tabular-nums text-primary">—</p>
        </div>
        <div className="bg-surface p-3 rounded-xl">
          <p className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">Avg. Time on Page</p>
          <p className="text-lg font-black tabular-nums text-primary">—</p>
        </div>
      </div>
    </div>
  )
}
