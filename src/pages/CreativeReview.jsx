import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import MarkdownRenderer from '../components/MarkdownRenderer'
import PerformanceRadar, { AXIS_GROUPS_BY_TYPE } from '../components/PerformanceRadar'
import { useAuth } from '../contexts/AuthContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import AiContextRail from '../components/ai-assistant/AiContextRail'
import {
  uploadCreativeAsset,
  reviewBanner,
  reviewAdLp,
  classifyError,
} from '../api/marketLens'
import { getCreativeReviewModel, getAnalysisProviderLabel } from '../utils/analysisProvider'
import { copyReportToClipboard, buildCreativeReviewReportText } from '../utils/reportExport'
import { recordScore } from '../utils/scoreHistory'

const REVIEW_TEXT_SIZE_STORAGE_KEY = 'creative_review_text_size'
const REVIEW_TEXT_SIZE_OPTIONS = [
  { value: 'normal', label: '標準' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '特大' },
]

const DEMO_NOTICE = '架空の検証用クリエイティブです。実在ブランド・実在商品ではありません。'
const DEMO_CREATIVES = [
  {
    id: 'interior',
    title: '架空インテリアEC',
    brandInfo: 'Mori & Vale Home（架空ブランド） / インテリアEC / 検証用デモ素材',
    operatorMemo: DEMO_NOTICE,
    src: '/demo-creatives/demo-creative-interior-300x250.png',
    fileName: 'demo-creative-interior-300x250.png',
  },
  {
    id: 'skincare',
    title: '架空スキンケアEC',
    brandInfo: 'Luma Neri Skin（架空ブランド） / スキンケアEC / 検証用デモ素材',
    operatorMemo: DEMO_NOTICE,
    src: '/demo-creatives/demo-creative-skincare-300x250.png',
    fileName: 'demo-creative-skincare-300x250.png',
  },
]

const RUBRIC_LABEL_MAP = {
  visual_impact: '視覚的インパクト',
  message_clarity: 'メッセージ明瞭性',
  cta_effectiveness: 'CTA効果',
  brand_consistency: 'ブランド整合性',
  information_balance: '情報バランス',
  hook_strength: 'フック力',
  target_clarity: 'ターゲット明瞭性',
  offer_clarity: 'オファー明瞭性',
  visual_flow: '視線誘導',
  cta_clarity: 'CTA明瞭性',
  credibility: '信頼性',
  information_density: '情報密度',
  competitive_edge: '競合差別化',
  first_view_clarity: 'ファーストビュー',
  ad_to_lp_message_match: '広告-LP一致',
  benefit_clarity: 'ベネフィット',
  trust_elements: '信頼要素',
  cta_placement: 'CTA配置',
  drop_off_risk: '離脱リスク',
  input_friction: '入力摩擦',
  story_consistency: 'ストーリー一貫性',
}

const BANNER_RUBRIC_IDS = [
  'visual_impact',
  'message_clarity',
  'cta_effectiveness',
  'brand_consistency',
  'information_balance',
  'hook_strength',
  'target_clarity',
  'offer_clarity',
]

function isFilledArray(value) {
  return Array.isArray(value) && value.length > 0
}

function normalizeCreativeReview(review) {
  if (!review || typeof review !== 'object') return review

  const next = { ...review }
  let complemented = false

  if (!next.review_type) {
    next.review_type = 'banner_review'
    complemented = true
  }
  if (!next.summary) {
    next.summary = 'AI出力に要約が含まれなかったため、運用者確認が必要です。'
    complemented = true
  }
  if (!next.target_hypothesis) {
    next.target_hypothesis = '評価保留: ターゲット仮説がAI出力に含まれませんでした。'
    complemented = true
  }
  if (!next.message_angle) {
    next.message_angle = '評価保留: メッセージ角度がAI出力に含まれませんでした。'
    complemented = true
  }
  if (!isFilledArray(next.good_points)) {
    next.good_points = [{
      point: '評価保留',
      reason: 'AI出力に良い点が含まれなかったため、運用者確認が必要です。',
    }]
    complemented = true
  }
  if (!isFilledArray(next.improvements)) {
    next.improvements = [{
      point: '評価保留',
      reason: 'AI出力に改善提案が含まれませんでした。',
      action: 'バナーの目的、CTA、訴求軸を運用者が確認してください。',
    }]
    complemented = true
  }
  if (!isFilledArray(next.evidence)) {
    next.evidence = [{
      evidence_type: 'evaluation_pending',
      evidence_source: 'AI出力',
      evidence_text: '根拠項目が欠落していたため、運用者確認が必要です。',
    }]
    complemented = true
  }
  if (!isFilledArray(next.rubric_scores)) {
    next.rubric_scores = BANNER_RUBRIC_IDS.map((rubricId) => ({
      rubric_id: rubricId,
      score: null,
      comment: '評価保留: AI出力に採点が含まれませんでした。',
    }))
    complemented = true
  }
  if (complemented) {
    next.operator_review_notice = 'AI出力の欠落項目を自動補完しました。施策化前に運用者確認が必要です。'
  }

  return next
}


// ─── Section-aware Review Blocks ───

function SectionCard({ icon, title, badge, badgeColor, borderColor, bgColor, children }) {
  return (
    <div className={`rounded-[0.75rem] border ${borderColor || 'border-outline-variant/15'} ${bgColor || 'bg-surface-container-lowest'} p-6 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-lg" style={{ color: 'inherit' }}>{icon}</span>
        <h4 className="text-base font-bold japanese-text text-on-surface">{title}</h4>
        {badge && (
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor || 'bg-surface-container text-on-surface-variant'}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function SummarySection({ review, size }) {
  const text = review?.summary
  if (!text) return null
  return (
    <SectionCard icon="summarize" title="要約" borderColor="border-outline-variant/20" bgColor="bg-surface-container-low/50">
      <MarkdownRenderer content={text} size={size} />
    </SectionCard>
  )
}

function NeutralInfoSection({ review, size }) {
  const parts = []
  if (review?.product_identification) parts.push(`### 製品特定\n${review.product_identification}`)
  if (review?.target_hypothesis) parts.push(`### ターゲット仮説\n${review.target_hypothesis}`)
  if (review?.message_angle) parts.push(`### メッセージ角度\n${review.message_angle}`)
  if (parts.length === 0) return null

  return (
    <SectionCard icon="info" title="基本情報" borderColor="border-outline-variant/20" bgColor="bg-surface-container-lowest">
      <MarkdownRenderer content={parts.join('\n\n')} size={size} />
    </SectionCard>
  )
}

function GoodPointsSection({ review, size }) {
  const items = [...(review?.good_points || []), ...(review?.keep_as_is || [])]
  if (items.length === 0) return null

  const md = items
    .map(({ point, reason }) => `- **${point}**\n  ${reason}`)
    .join('\n')

  return (
    <SectionCard
      icon="thumb_up"
      title="良い点・維持すべき点"
      badge={`${items.length} 件`}
      badgeColor="bg-emerald-100 dark:bg-success-container text-emerald-700 dark:text-on-success-container"
      borderColor="border-emerald-200 dark:border-success/30"
      bgColor="bg-emerald-50/40 dark:bg-success-container"
    >
      <div className="text-emerald-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function ImprovementsSection({ review, size }) {
  const items = review?.improvements
  if (!Array.isArray(items) || items.length === 0) return null

  const md = items
    .map(({ point, reason, action }, i) =>
      `${i + 1}. **${point}**\n   - 背景: ${reason}\n   - 対応: ${action}`)
    .join('\n')

  return (
    <SectionCard
      icon="build"
      title="改善提案"
      badge={`${items.length} 件`}
      badgeColor="bg-amber-100 dark:bg-warning-container/70 text-amber-700 dark:text-warning"
      borderColor="border-amber-200 dark:border-warning/30"
      bgColor="bg-amber-50/40 dark:bg-warning-container"
    >
      <div className="text-amber-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function TestIdeasSection({ review, size }) {
  const items = review?.test_ideas
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 仮説 | 変更変数 | 期待効果 |',
    '| --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.hypothesis)} | ${esc(item.variable)} | ${esc(item.expected_impact)} |`
    ),
  ].join('\n')

  return (
    <SectionCard
      icon="science"
      title="テストアイデア"
      badge={`${items.length} 件`}
      badgeColor="bg-rose-100 dark:bg-error-container text-rose-700 dark:text-on-error-container"
      borderColor="border-rose-200 dark:border-error/30"
      bgColor="bg-rose-50/30 dark:bg-error-container"
    >
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function EvidenceSection({ review, size }) {
  const items = review?.evidence
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 種別 | 出典 | 観察内容 |',
    '| --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.evidence_type)} | ${esc(item.evidence_source)} | ${esc(item.evidence_text)} |`
    ),
  ].join('\n')

  return (
    <SectionCard icon="fact_check" title="エビデンス" borderColor="border-outline-variant/20" bgColor="bg-surface-container-lowest">
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function RubricScoreGuide() {
  const [open, setOpen] = useState(false)
  const levels = [
    { score: 5, label: '優秀', desc: '業界トップレベル。改善の余地はほぼない', color: 'bg-emerald-100 dark:bg-success-container text-emerald-700 dark:text-on-success-container' },
    { score: 4, label: '良好', desc: '水準以上。微調整でさらに向上可能', color: 'bg-sky-100 dark:bg-info-container text-sky-700 dark:text-on-info-container' },
    { score: 3, label: '平均', desc: '業界平均レベル。改善の余地がある', color: 'bg-amber-100 dark:bg-warning-container/70 text-amber-700 dark:text-warning' },
    { score: 2, label: '要改善', desc: '平均以下。優先的な改善が必要', color: 'bg-orange-100 dark:bg-warning-container text-orange-700 dark:text-warning' },
    { score: 1, label: '問題あり', desc: '重大な問題。即時対応が望ましい', color: 'bg-rose-100 dark:bg-error-container text-rose-700 dark:text-on-error-container' },
  ]
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className={"material-symbols-outlined text-sm transition-transform " + (open ? 'rotate-90' : '')}>chevron_right</span>
        採点ガイド
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-5 gap-2">
          {levels.map(({ score, label, desc, color }) => (
            <div key={score} className={"rounded-lg px-3 py-2 " + color}>
              <p className="text-xs font-black">{score}/5 {label}</p>
              <p className="text-[10px] mt-0.5 opacity-80">{desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RubricSection({ review }) {
  const items = review?.rubric_scores
  if (!Array.isArray(items) || items.length === 0) return null

  const scoredItems = items.filter((item) => item.score != null)
  const avgScore = scoredItems.length > 0
    ? (scoredItems.reduce((sum, item) => sum + item.score, 0) / scoredItems.length).toFixed(1)
    : null

  return (
    <SectionCard
      icon="analytics"
      title="ルーブリック評価"
      badge={avgScore ? `平均 ${avgScore} / 5` : null}
      badgeColor="bg-secondary/10 text-secondary"
      borderColor="border-secondary/20"
      bgColor="bg-surface-container-lowest"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const label = RUBRIC_LABEL_MAP[item.rubric_id] || item.rubric_id
          const isNA = item.score == null
          const score = isNA ? 0 : item.score
          const pct = isNA ? 0 : (score / 5) * 100
          const barColor = isNA ? '' : score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400'
          return (
            <div key={item.rubric_id} className={`bg-surface-container/40 rounded-[0.75rem] px-4 py-3 ${isNA ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-on-surface japanese-text">{label}</span>
                {isNA ? (
                  <span className="text-sm font-black tabular-nums text-on-surface-variant">N/A</span>
                ) : (
                  <span className="text-sm font-black tabular-nums text-on-surface">{score}<span className="text-on-surface-variant font-normal text-xs">/5</span></span>
                )}
              </div>
              <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                {isNA ? (
                  <div className="h-full w-full rounded-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-outline-variant) 0px, var(--color-outline-variant) 4px, transparent 4px, transparent 7px)', opacity: 0.4 }} />
                ) : (
                  <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                )}
              </div>
              {item.comment && <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{item.comment}</p>}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function hasOperatorReviewNotice(review) {
  const text = JSON.stringify(review || {})
  return /運用者確認|評価保留|自動補完|欠落していたため|AI出力/.test(text)
}

function OperatorReviewNotice({ review }) {
  if (!hasOperatorReviewNotice(review)) return null
  return (
    <div className="rounded-[0.75rem] border border-amber-200 dark:border-warning/30 bg-amber-50/70 dark:bg-warning-container px-4 py-3 text-sm text-amber-800 dark:text-on-warning-container flex items-start gap-2">
      <span className="material-symbols-outlined text-lg" aria-hidden="true">pending</span>
      <div>
        <p className="font-bold japanese-text">評価保留・運用者確認を含みます</p>
        <p className="text-xs mt-0.5 japanese-text">AI出力の欠落項目は安全補完されています。good_points / improvements / evidence / rubric_scores の該当コメントを確認してから施策化してください。</p>
      </div>
    </div>
  )
}

function ReviewReadinessPanel({ fileName, assetMeta, lpUrl, hasAnalysisKey, providerLabel }) {
  const reviewMode = lpUrl.trim() ? '広告+LP統合レビュー' : 'バナーレビュー'
  const checks = [
    {
      icon: 'image',
      label: '画像',
      value: fileName || '未選択',
      ok: Boolean(fileName),
    },
    {
      icon: 'vpn_key',
      label: '分析キー',
      value: hasAnalysisKey ? `${providerLabel} で実行可能` : '未設定',
      ok: hasAnalysisKey,
    },
    {
      icon: 'route',
      label: 'レビュー方式',
      value: reviewMode,
      ok: true,
    },
    {
      icon: 'verified',
      label: '欠損補完',
      value: '不足項目は評価保留で表示',
      ok: true,
    },
  ]

  return (
    <section className="rounded-[0.75rem] bg-surface-container-lowest border border-outline-variant/10 p-5 space-y-4" aria-labelledby="creative-review-readiness-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black tracking-[0.16em] text-secondary">レビュー準備</p>
          <h3 id="creative-review-readiness-title" className="text-lg font-bold text-on-surface japanese-text mt-1">レビュー実行前チェック</h3>
        </div>
        {assetMeta?.width && assetMeta?.height && (
          <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant">
            {assetMeta.width} × {assetMeta.height}px
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {checks.map((item) => (
          <div key={item.label} className="rounded-xl bg-surface-container px-4 py-3 flex items-start gap-3 min-w-0">
            <span className={`material-symbols-outlined text-lg ${item.ok ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden="true">
              {item.ok ? item.icon : 'warning'}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-on-surface-variant">{item.label}</p>
              <p className="text-sm font-bold text-on-surface japanese-text break-words">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CategoryContextSection({ review, size }) {
  const ctx = review?.category_context
  if (!ctx) return null

  const md = [
    `**業界カテゴリ:** ${ctx.inferred_category}`,
    '',
    ...(ctx.observations || []).map((obs) => `- ${obs}`),
  ].join('\n')

  return (
    <SectionCard
      icon="category"
      title="業界コンテキスト"
      borderColor="border-indigo-200 dark:border-outline-variant"
      bgColor="bg-indigo-50/30 dark:bg-primary-container/30"
    >
      <div className="text-indigo-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function ValuePropositionSection({ review, size }) {
  const vpa = review?.value_proposition_analysis
  if (!vpa) return null

  const md = [
    `| 項目 | 内容 |`,
    `| --- | --- |`,
    `| 購入条件 | ${esc(vpa.purchase_threshold)} |`,
    `| インセンティブ | ${esc(vpa.incentive)} |`,
    `| 知覚価値評価 | ${esc(vpa.perceived_value_assessment)} |`,
    `| 伝達の明確さ | ${esc(vpa.communication_clarity)} |`,
  ].join('\n')

  return (
    <SectionCard
      icon="payments"
      title="価値提案分析"
      borderColor="border-violet-200 dark:border-outline-variant"
      bgColor="bg-violet-50/30 dark:bg-primary-container/30"
    >
      <div className="text-violet-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function PositioningSection({ review, size }) {
  const items = review?.positioning_insights
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 観点 | 自社 | 競合 | 示唆 |',
    '| --- | --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.dimension)} | ${esc(item.our_position)} | ${esc(item.competitor_position)} | ${esc(item.gap_analysis)} / ${esc(item.recommendation)} |`
    ),
  ].join('\n')

  return (
    <SectionCard icon="compare_arrows" title="ポジショニング分析" borderColor="border-outline-variant/20" bgColor="bg-surface-container-lowest">
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function esc(value) {
  if (value == null) return '-'
  return String(value).trim().replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ') || '-'
}

function RubricCategoryHeatmap({ review }) {
  const items = review?.rubric_scores
  if (!Array.isArray(items) || items.length === 0) return null

  // Detect review type like PerformanceRadar does
  const adLpIds = new Set(['ad_to_lp_message_match', 'benefit_clarity', 'input_friction', 'story_consistency'])
  const reviewType = items.some(s => adLpIds.has(s.rubric_id)) ? 'ad_lp_review' : 'banner_review'
  const axisGroups = AXIS_GROUPS_BY_TYPE[reviewType] || AXIS_GROUPS_BY_TYPE.banner_review

  const scoreMap = {}
  items.forEach((item) => {
    if (item.rubric_id && item.score != null) scoreMap[item.rubric_id] = item.score
  })

  return (
    <SectionCard
      icon="grid_view"
      title="カテゴリ別ヒートマップ"
      borderColor="border-outline-variant/20"
      bgColor="bg-surface-container-lowest"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(axisGroups).map(([key, group]) => {
          const scores = group.ids.map((id) => scoreMap[id]).filter((v) => v != null)
          const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
          const heatColor = avg == null ? 'bg-surface-container/40' : avg >= 4 ? 'bg-emerald-100' : avg >= 3 ? 'bg-amber-50' : 'bg-rose-50'
          const textColor = avg == null ? 'text-on-surface-variant/50' : avg >= 4 ? 'text-emerald-700' : avg >= 3 ? 'text-amber-700' : 'text-rose-700'
          return (
            <div key={key} className={'rounded-lg p-3 ' + heatColor}>
              <p className="text-xs font-bold text-on-surface mb-2">{group.label}</p>
              <div className="flex items-end gap-2">
                {avg != null ? (
                  <>
                    <span className={'text-2xl font-black tabular-nums ' + textColor}>{avg.toFixed(1)}</span>
                    <span className="text-xs text-on-surface-variant mb-0.5">/5</span>
                  </>
                ) : (
                  <span className="text-lg font-bold text-on-surface-variant/50">N/A</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {group.ids.map((id) => {
                  const s = scoreMap[id]
                  const dotColor = s == null ? 'bg-surface-container' : s >= 4 ? 'bg-emerald-400' : s >= 3 ? 'bg-amber-300' : 'bg-rose-400'
                  return (
                    <span key={id} className={'inline-block w-4 h-4 rounded ' + dotColor} title={`${RUBRIC_LABEL_MAP[id] || id}: ${s ?? 'N/A'}`} />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function getScoreSummary(review) {
  const items = Array.isArray(review?.rubric_scores) ? review.rubric_scores : []
  const scoredItems = items.filter((item) => item.score != null)
  if (scoredItems.length === 0) {
    return {
      score100: null,
      avg5: null,
      label: '評価保留',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      description: '採点データが不足しています。評価保留の根拠を確認してください。',
    }
  }

  const avg5 = scoredItems.reduce((sum, item) => sum + Number(item.score), 0) / scoredItems.length
  const score100 = Math.round(avg5 * 20)
  if (score100 >= 80) {
    return {
      score100,
      avg5: avg5.toFixed(1),
      label: '強み優勢',
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      description: '成果化できる要素が多く、微調整で伸ばしやすい状態です。',
    }
  }
  if (score100 >= 60) {
    return {
      score100,
      avg5: avg5.toFixed(1),
      label: '改善余地あり',
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      description: '訴求やCTAの優先修正で成果改善を狙える状態です。',
    }
  }
  return {
    score100,
    avg5: avg5.toFixed(1),
    label: '要修正',
    tone: 'text-rose-700 bg-rose-50 border-rose-200',
    description: '伝達・視線誘導・信頼要素を先に整えてから配信判断してください。',
  }
}

function getPendingItems(review) {
  const pending = []
  if (review?.operator_review_notice) pending.push(review.operator_review_notice)
  if (!review?.product_identification) pending.push('製品特定が不足しています')
  if (!review?.target_hypothesis) pending.push('ターゲット仮説が不足しています')
  if (!review?.message_angle) pending.push('メッセージ角度が不足しています')

  const evidence = Array.isArray(review?.evidence) ? review.evidence : []
  evidence.forEach((item) => {
    const text = `${item.evidence_type || ''} ${item.evidence_text || ''}`
    if (/評価保留|pending|欠落|不足|AI出力/.test(text)) {
      pending.push(item.evidence_text || item.evidence_type)
    }
  })

  return [...new Set(pending.filter(Boolean))].slice(0, 3)
}

function CompactScoreBars({ review }) {
  const items = Array.isArray(review?.rubric_scores) ? review.rubric_scores : []
  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.slice(0, 8).map((item) => {
        const label = RUBRIC_LABEL_MAP[item.rubric_id] || item.rubric_id
        const isNA = item.score == null
        const score = isNA ? 0 : Number(item.score)
        const pct = isNA ? 0 : Math.max(0, Math.min(100, (score / 5) * 100))
        const barColor = isNA ? 'bg-outline-variant/30' : score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400'
        return (
          <div key={item.rubric_id} className="min-w-0 rounded-lg bg-surface-container px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-bold text-on-surface japanese-text">{label}</span>
              <span className="shrink-0 text-xs font-black tabular-nums text-on-surface-variant">{isNA ? 'N/A' : `${score}/5`}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CreativeDecisionBoard({ review, previewUrl, fileName, assetMeta, size }) {
  const score = getScoreSummary(review)
  const firstImprovement = Array.isArray(review?.improvements) ? review.improvements[0] : null
  const firstTest = Array.isArray(review?.test_ideas) ? review.test_ideas[0] : null
  const pendingItems = getPendingItems(review)

  return (
    <section className="space-y-4" aria-labelledby="creative-decision-board-title">
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-secondary">Decision board</p>
        <h4 id="creative-decision-board-title" className="text-xl font-black text-on-surface japanese-text">最初に直すべきことが先に分かるレビュー</h4>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.25fr)]">
        <article className="rounded-[0.75rem] border border-outline-variant/15 bg-surface-container p-4">
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-sm font-black text-on-surface japanese-text">画像プレビュー</h5>
            {assetMeta?.width && assetMeta?.height && (
              <span className="rounded-full bg-surface-container-lowest px-2.5 py-1 text-[10px] font-bold text-on-surface-variant">
                {assetMeta.width} x {assetMeta.height}
              </span>
            )}
          </div>
          {previewUrl ? (
            <img src={previewUrl} alt={fileName || 'レビュー対象画像'} className="mt-3 max-h-[280px] w-full rounded-lg border border-outline-variant/20 object-contain bg-surface-container-lowest" />
          ) : (
            <div className="mt-3 grid h-48 place-items-center rounded-lg bg-surface-container-lowest text-sm text-on-surface-variant">プレビューなし</div>
          )}
          {fileName && <p className="mt-2 truncate text-xs font-bold text-on-surface-variant">{fileName}</p>}
        </article>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <article className={`rounded-[0.75rem] border p-4 ${score.tone}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-80">総合スコア</p>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-5xl font-black tabular-nums leading-none">{score.score100 ?? '--'}</span>
              <span className="pb-1 text-sm font-black">/100</span>
              <span className="ml-auto rounded-lg bg-white/65 px-3 py-1 text-xs font-black">{score.label}</span>
            </div>
            <p className="mt-3 text-xs font-bold leading-6">{score.description}</p>
            {score.avg5 && <p className="mt-2 text-[11px] font-bold opacity-70">平均 {score.avg5}/5</p>}
          </article>

          <article className="rounded-[0.75rem] border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-amber-700" aria-hidden="true">priority_high</span>
              <h5 className="text-sm font-black text-amber-900 japanese-text">最重要改善</h5>
            </div>
            {firstImprovement ? (
              <div className="mt-3 space-y-2 text-amber-950">
                <p className="text-base font-black japanese-text">{firstImprovement.point}</p>
                {firstImprovement.reason && <p className="text-xs leading-6 japanese-text">背景: {firstImprovement.reason}</p>}
                {firstImprovement.action && <p className="rounded-lg bg-white/70 px-3 py-2 text-xs font-bold leading-6 japanese-text">対応: {firstImprovement.action}</p>}
              </div>
            ) : (
              <p className="mt-3 text-xs font-bold text-amber-800">改善提案が不足しています。</p>
            )}
          </article>

          <article className="rounded-[0.75rem] border border-primary/15 bg-primary/[0.045] p-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-primary" aria-hidden="true">science</span>
              <h5 className="text-sm font-black text-on-surface japanese-text">テスト仮説</h5>
            </div>
            {firstTest ? (
              <dl className="mt-3 space-y-2 text-xs leading-6">
                <div>
                  <dt className="font-black text-primary">仮説</dt>
                  <dd className="font-bold text-on-surface japanese-text">{firstTest.hypothesis || '-'}</dd>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="font-black text-on-surface-variant">変更変数</dt>
                    <dd className="font-bold text-on-surface japanese-text">{firstTest.variable || '-'}</dd>
                  </div>
                  <div>
                    <dt className="font-black text-on-surface-variant">期待効果</dt>
                    <dd className="font-bold text-on-surface japanese-text">{firstTest.expected_impact || '-'}</dd>
                  </div>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-xs font-bold text-on-surface-variant">テスト案が不足しています。</p>
            )}
          </article>

          <article className="rounded-[0.75rem] border border-outline-variant/20 bg-surface-container-lowest p-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-amber-700" aria-hidden="true">pending</span>
              <h5 className="text-sm font-black text-on-surface japanese-text">評価保留</h5>
            </div>
            {pendingItems.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {pendingItems.map((item) => (
                  <li key={item} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800 japanese-text">{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 japanese-text">主要な評価保留はありません。</p>
            )}
          </article>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <SectionCard icon="analytics" title="コンパクトスコア" borderColor="border-outline-variant/20" bgColor="bg-surface-container-lowest">
          <CompactScoreBars review={review} />
        </SectionCard>
        {review?.rubric_scores && (
          <div className="min-w-0 [&_.panel-card-hover]:shadow-none">
            <PerformanceRadar rubricScores={review.rubric_scores} reviewType={review.review_type} compact />
          </div>
        )}
      </div>

      {review?.summary && (
        <SectionCard icon="summarize" title="レビュー本文サマリー" borderColor="border-outline-variant/20" bgColor="bg-surface-container-low/50">
          <MarkdownRenderer content={review.summary} size={size} />
        </SectionCard>
      )}
    </section>
  )
}

function ReviewResultDisplay({ review, size, previewUrl, fileName, assetMeta }) {
  if (!review) return null

  // If string (raw markdown), fall back to MarkdownRenderer
  if (typeof review === 'string') {
    return <MarkdownRenderer content={review} size={size} />
  }

  // If structured review with no recognized fields, fall back to markdown or JSON
  const hasStructured = review.summary || review.product_identification || review.target_hypothesis ||
    review.message_angle || review.good_points || review.keep_as_is || review.improvements ||
    review.rubric_scores || review.test_ideas || review.evidence || review.positioning_insights

  if (!hasStructured && review.markdown) {
    return <MarkdownRenderer content={review.markdown} size={size} />
  }

  if (!hasStructured) {
    return (
      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-on-surface-variant">
        {JSON.stringify(review, null, 2)}
      </pre>
    )
  }

  return (
    <div className="space-y-5">
      {review.demo_creative && (
        <div className="rounded-[0.75rem] border border-secondary/20 bg-secondary/10 px-4 py-3 text-sm text-on-surface flex items-start gap-2">
          <span className="material-symbols-outlined text-lg text-secondary" aria-hidden="true">experiment</span>
          <div>
            <p className="font-bold japanese-text">検証用の架空デモ素材</p>
            <p className="text-xs mt-0.5 text-on-surface-variant japanese-text">{review.demo_notice || DEMO_NOTICE}</p>
          </div>
        </div>
      )}
      <CreativeDecisionBoard review={review} previewUrl={previewUrl} fileName={fileName} assetMeta={assetMeta} size={size} />

      <section className="space-y-4" aria-labelledby="creative-ab-plan-title">
        <h4 id="creative-ab-plan-title" className="text-lg font-black text-on-surface japanese-text">A/Bテスト計画</h4>
        <TestIdeasSection review={review} size={size} />
        <ValuePropositionSection review={review} size={size} />
      </section>

      <section className="space-y-4" aria-labelledby="creative-risk-title">
        <h4 id="creative-risk-title" className="text-lg font-black text-on-surface japanese-text">法務・表現リスク</h4>
        <OperatorReviewNotice review={review} />
        <NeutralInfoSection review={review} size={size} />
        <CategoryContextSection review={review} size={size} />
      </section>

      <section className="space-y-4" aria-labelledby="creative-evidence-title">
        <h4 id="creative-evidence-title" className="text-lg font-black text-on-surface japanese-text">エビデンス一覧</h4>
        <EvidenceSection review={review} size={size} />
        <RubricCategoryHeatmap review={review} />
        <RubricSection review={review} />
        <PositioningSection review={review} size={size} />
      </section>

      <section className="space-y-4" aria-labelledby="creative-brief-title">
        <h4 id="creative-brief-title" className="text-lg font-black text-on-surface japanese-text">修正ブリーフ</h4>
        <ImprovementsSection review={review} size={size} />
        <GoodPointsSection review={review} size={size} />
      </section>
    </div>
  )
}

// ─── Meta Band ───

function formatElapsed(ms) {
  if (!ms) return null
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`
}

function MetaBand({ run }) {
  if (!run || run.status === 'idle') return null
  const elapsed = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null

  return (
    <div className="flex items-center gap-3 text-xs text-on-surface-variant">
      <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
        <span className={`w-1.5 h-1.5 rounded-full ${
          run.status === 'running' ? 'bg-amber-400 animate-pulse' :
          run.status === 'completed' ? 'bg-emerald-500' :
          'bg-red-400'
        }`} />
        {run.status === 'running' ? 'レビュー中…' : run.status === 'completed' ? 'レビュー完了' : 'エラー'}
      </span>
      {run.meta?.run_id && <span className="text-outline font-mono">run: {run.meta.run_id}</span>}
      {run.meta?.providerLabel && (
        <span className="px-3 py-1 bg-surface-container rounded-full font-bold">{run.meta.providerLabel}</span>
      )}
      {elapsed && <span>{formatElapsed(elapsed)}</span>}
    </div>
  )
}


// ─── Main Component ───

export default function CreativeReview() {
  const {
    analysisKey,
    analysisProvider,
    hasAnalysisKey,
  } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun } = useAnalysisRuns()

  const reviewRun = getRun('creative-review')

  // ─── local state (upload form — not long-running, doesn't need run store) ───
  const [phase, setPhase] = useState(() => {
    if (reviewRun?.status === 'completed') return 'reviewed'
    if (reviewRun?.status === 'running') return 'reviewing'
    if (reviewRun?.status === 'failed' && reviewRun?.input?.assetId) return 'uploaded'
    if (reviewRun?.input?.assetId) return 'uploaded'
    return 'idle'
  })

  const persistedErrorState = reviewRun?.status === 'failed'
    ? {
        message: `レビュー失敗: ${reviewRun.error}`,
        info: reviewRun.errorInfo || null,
      }
    : {
        message: '',
        info: null,
      }

  const [errorMessage, setErrorMessage] = useState(() => persistedErrorState.message)
  const [errorInfo, setErrorInfo] = useState(() => persistedErrorState.info)
  const [previewUrl, setPreviewUrl] = useState(() => reviewRun?.input?.previewUrl || null)
  const [fileName, setFileName] = useState(() => reviewRun?.input?.fileName || '')
  const [assetId, setAssetId] = useState(() => reviewRun?.input?.assetId || null)
  const [assetMeta, setAssetMeta] = useState(() => reviewRun?.input?.assetMeta || null)
  const [demoCreative, setDemoCreative] = useState(() => reviewRun?.input?.demoCreative || null)

  const [brandInfo, setBrandInfo] = useState(() => reviewRun?.input?.brandInfo || '')
  const [operatorMemo, setOperatorMemo] = useState(() => reviewRun?.input?.operatorMemo || '')
  const [lpUrl, setLpUrl] = useState(() => reviewRun?.input?.lpUrl || '')

  const reviewResult = reviewRun?.result?.review || reviewRun?.result || null
  const runId = reviewRun?.meta?.run_id || null
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const reviewModel = getCreativeReviewModel(analysisProvider)

  const [reviewTextSize, setReviewTextSize] = useState(
    () => localStorage.getItem(REVIEW_TEXT_SIZE_STORAGE_KEY) || 'large',
  )

  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

  // ─── helpers ───
  const resetAll = useCallback(() => {
    setPhase('idle')
    setErrorMessage('')
    setErrorInfo(null)
    setPreviewUrl(null)
    setFileName('')
    setAssetId(null)
    setAssetMeta(null)
    setDemoCreative(null)
    setBrandInfo('')
    setOperatorMemo('')
    setLpUrl('')
    clearRun('creative-review')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [clearRun])

  const goError = useCallback((msg, info) => {
    setPhase('error')
    setErrorMessage(msg)
    setErrorInfo(info || null)
  }, [])

  const handleReviewTextSizeChange = useCallback((size) => {
    setReviewTextSize(size)
    localStorage.setItem(REVIEW_TEXT_SIZE_STORAGE_KEY, size)
  }, [])

  // ─── 1. Upload ───
  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      goError('画像ファイル（PNG/JPG）を選択してください。')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => setPreviewUrl(e.target.result)
    reader.readAsDataURL(file)
    setFileName(file.name)

    setPhase('uploading')
    setErrorMessage('')
    setErrorInfo(null)
    if (!file.demoCreative) setDemoCreative(null)
    try {
      const data = await uploadCreativeAsset(file)
      setAssetId(data.asset_id)
      setAssetMeta(data)
      setPhase('uploaded')
    } catch (err) {
      goError(`アップロード失敗: ${err.message}`, classifyError(err))
    }
  }, [goError])

  const handleDemoCreative = useCallback(async (demo) => {
    try {
      setDemoCreative(demo)
      setBrandInfo(demo.brandInfo)
      setOperatorMemo(demo.operatorMemo)
      setLpUrl('')
      const res = await fetch(demo.src)
      if (!res.ok) throw new Error('デモ素材を読み込めませんでした。')
      const blob = await res.blob()
      const file = new File([blob], demo.fileName, { type: blob.type || 'image/png' })
      file.demoCreative = demo
      await handleFile(file)
    } catch (err) {
      goError(`デモ素材の読み込み失敗: ${err.message}`, classifyError(err))
    }
  }, [goError, handleFile])

  const onFileChange = useCallback((e) => {
    handleFile(e.target.files[0])
  }, [handleFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.remove('ring-2', 'ring-secondary')
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.add('ring-2', 'ring-secondary')
  }, [])

  const onDragLeave = useCallback(() => {
    dropZoneRef.current?.classList.remove('ring-2', 'ring-secondary')
  }, [])

  const onDropZoneKeyDown = useCallback((e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    fileInputRef.current?.click()
  }, [])

  // ─── 2. Review ───
  const handleReview = useCallback(async () => {
    if (!assetId || !analysisKey.trim() || !analysisProvider) return

    setPhase('reviewing')
    setErrorMessage('')
    setErrorInfo(null)

    startRun('creative-review', {
      assetId, brandInfo, operatorMemo, lpUrl,
      previewUrl, fileName, assetMeta, demoCreative,
    })

    try {
      const payload = {
        asset_id: assetId,
        brand_info: brandInfo,
        operator_memo: operatorMemo,
      }

      let envelope
      if (lpUrl.trim()) {
        payload.landing_page = { url: lpUrl.trim() }
        envelope = await reviewAdLp(payload, {
          apiKey: analysisKey.trim(),
          provider: analysisProvider,
          model: reviewModel,
        })
      } else {
        envelope = await reviewBanner(payload, {
          apiKey: analysisKey.trim(),
          provider: analysisProvider,
          model: reviewModel,
        })
      }

      const review = normalizeCreativeReview(envelope?.review || envelope)
      if (demoCreative && review && typeof review === 'object') {
        review.demo_creative = true
        review.demo_notice = DEMO_NOTICE
      }

      // Empty response guard
      if (!review || (typeof review === 'object' && !review.summary && !review.good_points && !review.improvements && !review.rubric_scores && !review.markdown && Object.keys(review).length === 0)) {
        throw new Error('バックエンドから空のレスポンスが返されました。AIの応答生成に失敗した可能性があります。しばらく待って再試行してください。')
      }

      completeRun('creative-review', { review, envelope }, {
        run_id: envelope.run_id,
        providerLabel,
      })
      setPhase('reviewed')

      // Record rubric average score for history
      if (review?.rubric_scores?.length) {
        const scored = review.rubric_scores.filter(s => s.score != null)
        if (scored.length > 0) {
          const avg = Math.round((scored.reduce((sum, s) => sum + s.score, 0) / scored.length) * 20)
          recordScore('creative-review', { score: avg, timestamp: Date.now() })
        }
      }
    } catch (err) {
      const info = classifyError(err)
      failRun('creative-review', err.message, info)
      // Stay in 'uploaded' phase so the user can retry without losing asset state
      setPhase('uploaded')
      setErrorMessage(`レビュー失敗: ${err.message}`)
      setErrorInfo(info)
    }
  }, [assetId, analysisKey, analysisProvider, brandInfo, operatorMemo, lpUrl, previewUrl, fileName, assetMeta, demoCreative, providerLabel, reviewModel, startRun, completeRun, failRun])

  // ─── render helpers ───
  const isUploaded = ['uploaded', 'reviewing', 'reviewed'].includes(phase)
  const isReviewed = phase === 'reviewed'
  const creativeRailStatus = phase === 'reviewing' ? 'レビュー中' : isReviewed ? '完了' : errorMessage ? 'エラー' : isUploaded ? '設定中' : '画像待ち'
  const creativeRailInput = fileName
    ? `${fileName}${lpUrl.trim() ? ' / LP統合' : ' / バナー単体'}`
    : '画像未選択'

  return (
    <div className={`mx-auto grid max-w-[1520px] grid-cols-1 gap-6 p-4 sm:p-6 lg:p-8 ${isReviewed ? '2xl:grid-cols-[minmax(0,1fr)_336px] 2xl:items-start' : ''}`}>
      {/* Header */}
      <header>
        <div>
          <nav aria-label="パンくず" className="mb-3 flex items-center gap-2 text-xs text-on-surface-variant sm:text-sm">
            <span>追加分析</span>
            <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
            <span className="font-bold text-secondary">広告画像を確認</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface japanese-text sm:text-4xl">広告画像を確認する</h1>
            <span className="inline-flex items-center rounded-full bg-secondary/10 px-3 py-1 text-[11px] font-bold text-secondary">
              バナーレビュー
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-on-surface-variant japanese-text sm:text-base">
            広告画像を1枚選ぶと、伝わりやすさ・ボタンの目立ちやすさ・最初に直す場所を確認できます。
          </p>
        </div>
      </header>

      {isReviewed && (
        <AiContextRail
          className="hidden 2xl:col-start-2 2xl:row-start-1 2xl:row-span-[99] 2xl:block"
          screenName="クリエイティブレビュー助手"
          status={creativeRailStatus}
          inputSummary={creativeRailInput}
          evidence={['視覚インパクト', 'メッセージ明瞭性', 'CTA', 'ブランド適合', '欠損根拠']}
          suggestedQuestions={[
            '最初に直すべき要素を根拠つきで3つに絞って',
            'A/Bテスト案を仮説・変更変数・期待指標で整理して',
            '未観測の根拠を評価保留として分けて',
          ]}
          primaryAction="レビュー結果を広告改善案へ変換する"
          helperText="スコアだけでなく、観測できた画像要素・推論・未取得情報を分けて施策化します。"
        />
      )}

      {/* Error Banner — shown whenever there's an error, regardless of phase */}
      {errorMessage && (
        <ErrorBanner
          message={errorMessage}
          errorInfo={errorInfo}
          onRetry={() => {
            setErrorMessage('')
            setErrorInfo(null)
            if (phase === 'error') {
              if (assetId) setPhase('uploaded')
              else resetAll()
            }
          }}
        />
      )}

      {/* Meta Band */}
      {reviewRun && <MetaBand run={reviewRun} />}

      {/* ─── API Key Status ─── */}
      <section
        aria-label="分析用APIキーの状態"
        className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5 ${
          hasAnalysisKey
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-success/30 dark:bg-success-container dark:text-on-success-container'
            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-warning/30 dark:bg-warning-container dark:text-on-warning-container'
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-lg" aria-hidden="true">{hasAnalysisKey ? 'check_circle' : 'vpn_key'}</span>
          <div>
            <p className="font-bold japanese-text">{hasAnalysisKey ? '分析の準備ができています' : '分析用APIキーを設定してください'}</p>
            <p className="mt-0.5 text-xs leading-5 japanese-text">
              {hasAnalysisKey
                ? `${providerLabel} を使って画像を確認します。`
                : '画像の選択はできます。結果を作るには Gemini または Claude のAPIキーが必要です。'}
            </p>
          </div>
        </div>
        {!hasAnalysisKey && (
          <Link
            to="/settings"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            APIキーを設定する
          </Link>
        )}
      </section>

      {/* ─── Step 1: Upload (full-width when no file uploaded) ─── */}
      {(!isUploaded && phase !== 'uploading') && (
        <section className="rounded-xl bg-surface-container-lowest p-4 panel-card-hover sm:p-6" aria-labelledby="creative-upload-title">
          <h3 className="text-lg font-bold text-on-surface japanese-text mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">1</span>
            <span id="creative-upload-title">広告画像を選ぶ</span>
          </h3>
          <div
            ref={dropZoneRef}
            role="button"
            tabIndex={0}
            aria-label="バナー画像をアップロード"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={onDropZoneKeyDown}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className="ghost-border-thick flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-dashed p-6 text-center transition-[border-color,background-color,box-shadow] hover:border-secondary hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary sm:min-h-52 sm:p-10"
          >
            <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3" aria-hidden="true">cloud_upload</span>
            <p className="text-sm font-bold text-on-surface japanese-text">クリックして画像を選択</p>
            <p className="mt-1 text-xs text-on-surface-variant japanese-text">PCではドラッグ＆ドロップにも対応しています（PNG / JPG / WebP）</p>
            <input
              ref={fileInputRef}
              aria-label="バナー画像ファイル"
              name="creative-review-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFileChange}
              className="hidden"
            />
          </div>
          <details className="mt-4 rounded-xl bg-surface-container px-4 py-3 sm:px-5">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-on-surface japanese-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary">
              自分の画像がない場合は、架空デモ素材で試す
            </summary>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant japanese-text">{DEMO_NOTICE}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DEMO_CREATIVES.map((demo) => (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => handleDemoCreative(demo)}
                  className="flex min-h-14 items-center gap-3 rounded-xl bg-surface-container-lowest px-3 py-3 text-left hover:bg-secondary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                >
                  <img src={demo.src} alt="" width="58" height="48" className="h-12 w-[58px] rounded-md border border-outline-variant/20 object-cover" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-on-surface japanese-text">{demo.title}</span>
                    <span className="block text-[11px] text-on-surface-variant japanese-text">この素材で試す</span>
                  </span>
                </button>
              ))}
            </div>
          </details>
        </section>
      )}

      {phase === 'uploading' && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
          <div className="flex flex-col items-center py-8 gap-3">
            {previewUrl && <img src={previewUrl} alt="プレビュー" className="w-48 h-auto rounded-xl opacity-60" />}
            <LoadingSpinner label="アップロード中…" />
          </div>
        </div>
      )}

      {/* ─── Two-column layout (Stitch 2): Left preview + Right analysis ─── */}
      {isUploaded && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12 xl:gap-10">
          {/* Left: sticky preview */}
          <div className="space-y-4 xl:col-span-5 xl:sticky xl:top-24 xl:self-start">
            <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
              <h3 className="text-lg font-bold text-on-surface japanese-text mb-4 flex items-center gap-2">
                <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">1</span>
                アップロード画像
              </h3>
              {previewUrl && (
                <img src={previewUrl} alt="アップロード済み画像" className="w-full h-auto rounded-xl border border-outline-variant shadow-sm mb-4" />
              )}
              <div className="space-y-2">
                <p className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-600 text-lg">check_circle</span>
                  {fileName}
                </p>
                {demoCreative && (
                  <p className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary japanese-text">
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">experiment</span>
                    検証用の架空デモ素材
                  </p>
                )}
                {assetMeta && (
                  <div className="text-xs text-on-surface-variant space-y-0.5">
                    {assetMeta.width && assetMeta.height && <p>{assetMeta.width} × {assetMeta.height}px</p>}
                    {assetMeta.mime_type && <p>{assetMeta.mime_type}</p>}
                    {assetMeta.size_bytes && <p>{(assetMeta.size_bytes / 1024).toFixed(1)} KB</p>}
                  </div>
                )}
                <p className="text-xs text-on-surface-variant/50 font-mono">asset_id: {assetId}</p>
                <button
                  onClick={resetAll}
                  className="mt-2 px-4 py-1.5 text-xs bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors text-on-surface-variant font-bold"
                >
                  別の画像をアップロード
                </button>
              </div>
            </div>
          </div>

          {/* Right: review settings, results, generation */}
          <div className="space-y-8 xl:col-span-7">
            <ReviewReadinessPanel
              fileName={fileName}
              assetMeta={assetMeta}
              lpUrl={lpUrl}
              hasAnalysisKey={hasAnalysisKey}
              providerLabel={providerLabel}
            />

            {/* ─── Step 2: Review Input ─── */}
            <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-4">
              <h3 className="text-lg font-bold text-on-surface japanese-text mb-2 flex items-center gap-2">
                <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">2</span>
                レビュー設定
              </h3>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label htmlFor="creative-review-brand-info" className="block text-xs font-bold text-on-surface-variant mb-1">ブランド情報（任意）</label>
                  <input
                    id="creative-review-brand-info"
                    name="creative-review-brand-info"
                    type="text"
                    autoComplete="off"
                    value={brandInfo}
                    onChange={(e) => setBrandInfo(e.target.value)}
                    placeholder="例: 化粧品ブランドA、ターゲット20代女性…"
                    className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  />
                </div>
                <div>
                  <label htmlFor="creative-review-lp-url" className="block text-xs font-bold text-on-surface-variant mb-1">LP URL（任意 — 入力するとLP統合レビュー）</label>
                  <input
                    id="creative-review-lp-url"
                    name="creative-review-lp-url"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={lpUrl}
                    onChange={(e) => setLpUrl(e.target.value)}
                    placeholder="例: https://example.com/lp…"
                    className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="creative-review-operator-memo" className="block text-xs font-bold text-on-surface-variant mb-1">運用メモ（任意）</label>
                <textarea
                  id="creative-review-operator-memo"
                  name="creative-review-operator-memo"
                  autoComplete="off"
                  value={operatorMemo}
                  onChange={(e) => setOperatorMemo(e.target.value)}
                  placeholder="レビューで注目してほしいポイントなど…"
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary resize-none"
                />
              </div>

                <button
                  onClick={handleReview}
                disabled={!analysisKey.trim() || phase === 'reviewing'}
                className="px-6 py-3 bg-primary-container text-on-primary rounded-[0.75rem] font-bold flex items-center gap-2 hover:opacity-88 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {phase === 'reviewing' ? (
                  <LoadingSpinner size="sm" label="レビュー中…" />
                ) : (
                  <>
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">rate_review</span>
                    {lpUrl.trim() ? '広告+LP統合レビューを実行' : 'バナーレビューを実行'}
                  </>
                )}
              </button>

              {!analysisKey.trim() && (
                <p className="text-xs text-amber-600 dark:text-warning">Gemini または Claude の分析用 API キーを設定してください。</p>
              )}
            </div>

            {/* ─── Step 3: Review Result (section-aware blocks) ─── */}
            {isReviewed && reviewResult && (
              <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-on-surface japanese-text flex items-center gap-2">
                      <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">3</span>
                      レビュー結果
                    </h3>
                    <button
                      onClick={() => copyReportToClipboard(buildCreativeReviewReportText({ review: reviewResult }))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      レポートをコピー
                    </button>
                  </div>
                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <span className="text-xs font-bold text-on-surface-variant japanese-text">文字サイズ</span>
                    <div className="inline-flex rounded-full bg-surface-container p-1">
                      {REVIEW_TEXT_SIZE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleReviewTextSizeChange(option.value)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                            reviewTextSize === option.value
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant hover:bg-surface-container-high'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Section-aware review blocks — decision board first, compact score visualization */}
                <ReviewResultDisplay
                  review={reviewResult}
                  size={reviewTextSize}
                  previewUrl={previewUrl}
                  fileName={fileName}
                  assetMeta={assetMeta}
                />

                {runId && (
                  <p className="text-xs text-on-surface-variant/50 font-mono">run_id: {runId}</p>
                )}

              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Flow Guide (idle only) ─── */}
      {phase === 'idle' && (
        <details className="rounded-xl bg-surface-container-lowest px-4 py-3 panel-card-hover sm:px-6">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-on-surface japanese-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary">
            使い方と確認できること
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { icon: 'cloud_upload', title: '画像を選ぶ', desc: '広告に使う画像を1枚選択します' },
              { icon: 'rate_review', title: '結果を確認', desc: `${providerLabel}が良い点と最初の修正を整理します` },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-surface-container p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary/10">
                  <span className="material-symbols-outlined text-xl text-secondary" aria-hidden="true">{step.icon}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface japanese-text">{step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-on-surface-variant japanese-text">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
