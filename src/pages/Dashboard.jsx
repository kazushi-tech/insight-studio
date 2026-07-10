import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Chart from 'chart.js/auto'
import { getScans } from '../api/marketLens'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useAuth } from '../contexts/AuthContext'
import { getChartPeriodTags, getDisplayChartGroups } from '../utils/adsReports'
import { resolveBeginnerReportAction } from '../utils/dashboardNavigation'
import { SkeletonBlock } from '../components/ui'
import { getAnalysisProviderLabel } from '../utils/analysisProvider'

const EMPTY_LIST = []

function LiveStatCard({ icon, label, value, unit, subtitle, change, onClick }) {
  return (
    <div
      className={`motion-card bg-surface-container-lowest p-6 rounded-[0.75rem] ghost-border panel-card-hover flex flex-col gap-4 ${onClick ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onClick()
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-xl bg-primary-container/10 flex items-center justify-center text-primary-container">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        {change && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${change.startsWith('+') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {change}
          </span>
        )}
      </div>
      <div>
        <p className="text-on-surface-variant text-sm font-bold japanese-text">{label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-[30px] font-bold text-primary tabular-nums leading-none">{value}</span>
          {unit && <span className="text-sm text-on-surface-variant font-medium">{unit}</span>}
        </div>
      </div>
      {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
    </div>
  )
}

function EmptyStatCard({ icon, label, message, actionLabel, onAction }) {
  return (
    <div className="motion-card bg-surface-container-lowest p-6 rounded-[0.75rem] ghost-border panel-card-hover flex flex-col gap-4">
      <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-outline-variant">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div>
        <p className="text-on-surface-variant text-sm font-bold japanese-text">{label}</p>
        <p className="text-sm text-on-surface-variant mt-1">{message}</p>
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="text-sm font-bold text-secondary hover:underline text-left flex items-center gap-1"
        >
          {actionLabel}
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </button>
      )}
    </div>
  )
}

const COMPACT_PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6']

function CompactChartCard({ group, onClick }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const labels = Array.isArray(group?.labels) ? group.labels : EMPTY_LIST
  const datasets = Array.isArray(group?.datasets) ? group.datasets : EMPTY_LIST

  const latestValue = useMemo(() => {
    if (datasets.length === 0) return null
    const data = datasets[0]?.data
    if (!Array.isArray(data) || data.length === 0) return null
    for (let i = data.length - 1; i >= 0; i--) {
      const v = Number(data[i])
      if (Number.isFinite(v)) return v
    }
    return null
  }, [datasets])

  useEffect(() => {
    if (!canvasRef.current || labels.length === 0 || datasets.length === 0) return

    chartRef.current?.destroy()

    const isBar = group?.chartType === 'bar_horizontal'
    const chartDatasets = datasets.slice(0, 2).map((ds, i) => {
      const color = COMPACT_PALETTE[i % COMPACT_PALETTE.length]
      const data = (Array.isArray(ds?.data) ? ds.data : []).map((v) => {
        const n = Number(typeof v === 'string' ? v.replace(/,/g, '').replace(/[%％]$/, '') : v)
        return Number.isFinite(n) ? n : null
      })
      return isBar
        ? { data, backgroundColor: color + '88', borderColor: color, borderWidth: 1, borderRadius: 4, maxBarThickness: 16 }
        : { data, borderColor: color, backgroundColor: 'transparent', tension: 0.3, fill: false, borderWidth: 2, pointRadius: 0 }
    })

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: isBar ? 'bar' : 'line',
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: isBar ? 'y' : 'x',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [group, labels, datasets])

  return (
    <div
      className="motion-card bg-surface-container-lowest p-5 rounded-[0.75rem] panel-card-hover cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick?.()
      }}
      role="button"
      tabIndex={0}
    >
      <p className="text-xs font-bold text-on-surface-variant japanese-text truncate mb-1">{group?.title || '無題'}</p>
      {latestValue != null && (
        <p className="text-2xl font-black text-primary tabular-nums mb-2">
          {latestValue.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}
        </p>
      )}
      <div className="h-[60px]">
        <canvas ref={canvasRef} />
      </div>
      {group?._periodTag && (
        <p className="text-[10px] text-on-surface-variant mt-1">{group._periodTag}</p>
      )}
    </div>
  )
}

const TIMEFRAME_OPTIONS = [
  { value: 'latest', label: '最新期間' },
  { value: 'all', label: '全期間比較' },
]

function ChartOverviewSection({ chartGroups, periodTags, onDrillDown }) {
  const [timeframe, setTimeframe] = useState('latest')
  const displayGroups = useMemo(
    () => getDisplayChartGroups(chartGroups, timeframe).slice(0, 4),
    [chartGroups, timeframe],
  )

  const allOptions = useMemo(() => {
    const base = [...TIMEFRAME_OPTIONS]
    periodTags.forEach((tag) => {
      if (tag !== 'latest' && tag !== 'all') {
        base.push({ value: tag, label: tag })
      }
    })
    return base
  }, [periodTags])

  if (displayGroups.length === 0) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black tracking-[0.12em] text-secondary japanese-text">最新データ</p>
          <h2 className="mt-1 text-2xl font-bold text-on-surface japanese-text">Webサイトデータの概要</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="表示する期間"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="text-sm font-bold text-on-surface bg-surface-container rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            {allOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={onDrillDown}
            className="text-sm font-bold text-secondary flex items-center gap-1 hover:underline"
          >
            詳細グラフ
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {displayGroups.map((group, i) => (
          <CompactChartCard key={`${group?.title ?? i}-${i}`} group={group} onClick={onDrillDown} />
        ))}
      </div>
    </div>
  )
}

function SetupStatusCard({ setupState, reportBundle, isAdsAuthenticated, onNavigate }) {
  if (!isAdsAuthenticated) {
    return (
      <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card-hover">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-[0.75rem] bg-amber-50 dark:bg-warning-container flex items-center justify-center text-amber-600 dark:text-warning">
            <span className="material-symbols-outlined">lock</span>
          </div>
          <h4 className="text-lg font-bold japanese-text">Webサイト分析</h4>
        </div>
        <p className="text-sm text-on-surface-variant">Webサイト分析への接続が必要です。サイドバーのAPIキー・接続設定から認証してください。</p>
      </div>
    )
  }

  if (!setupState) {
    return (
      <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card-hover">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-[0.75rem] bg-amber-50 dark:bg-warning-container flex items-center justify-center text-amber-600 dark:text-warning">
            <span className="material-symbols-outlined">settings_suggest</span>
          </div>
          <h4 className="text-lg font-bold japanese-text">Webサイト分析の準備</h4>
        </div>
        <p className="text-sm text-on-surface-variant mb-3">準備を完了すると、まとめ・グラフ・AI考察を利用できます。</p>
        <button
          onClick={() => onNavigate('/ads/wizard')}
          className="text-sm font-bold text-secondary hover:underline flex items-center gap-1"
        >
          セットアップを開始
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </button>
      </div>
    )
  }

  const completedAt = setupState.completedAt ? new Date(setupState.completedAt) : null
  const formattedDate = completedAt
    ? completedAt.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card-hover">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-[0.75rem] bg-emerald-50 dark:bg-success-container flex items-center justify-center text-emerald-600 dark:text-on-success-container">
          <span className="material-symbols-outlined">check_circle</span>
        </div>
        <h4 className="text-lg font-bold japanese-text">Webサイト分析の準備</h4>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-on-surface-variant">クエリ種別</span>
          <span className="font-bold">{setupState.queryTypes?.length ?? 0} 種</span>
        </div>
        <div className="flex justify-between">
          <span className="text-on-surface-variant">対象期間</span>
          <span className="font-bold">{setupState.periods?.length ?? 0} 期間</span>
        </div>
        <div className="flex justify-between">
          <span className="text-on-surface-variant">粒度</span>
          <span className="font-bold">{setupState.granularity ?? '-'}</span>
        </div>
        {reportBundle?.chartGroups && (
          <div className="flex justify-between">
            <span className="text-on-surface-variant">生成グラフ</span>
            <span className="font-bold">{reportBundle.chartGroups.length} 件</span>
          </div>
        )}
        {formattedDate && (
          <div className="flex justify-between">
            <span className="text-on-surface-variant">最終セットアップ</span>
            <span className="font-bold tabular-nums">{formattedDate}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <button
          onClick={() => onNavigate('/ads/report')}
          className="py-2 text-sm font-bold text-secondary hover:bg-secondary/5 rounded-lg transition-colors text-center"
        >
          レポート
        </button>
        <button
          onClick={() => onNavigate('/insights/ai')}
          className="py-2 text-sm font-bold text-secondary hover:bg-secondary/5 rounded-lg transition-colors text-center"
        >
          AI考察
        </button>
      </div>
    </div>
  )
}

function TodayFeatureBoard({ hasAnalysisKey, isAdsAuthenticated, setupState, analysisProvider, canUseAdvancedAnalysis }) {
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const items = [
    {
      icon: 'psychology',
      title: '数字についてAIに聞く',
      term: 'AI考察',
      description: 'Webサイトの数字と根拠グラフをもとに、次に見る場所を整理します。',
      status: !isAdsAuthenticated || !setupState
        ? '分析の準備が必要'
        : hasAnalysisKey
          ? `${providerLabel}で詳しく分析`
          : 'APIキーなしで利用可',
      tone: isAdsAuthenticated && setupState ? 'ok' : 'need',
      path: isAdsAuthenticated && setupState ? '/insights/ai' : '/ads/wizard',
    },
    {
      icon: 'compare',
      title: '自社と競合LPを比べる',
      term: '競合LP分析',
      description: '複数のLPを同じ観点で比べ、訴求や構成の違いを見つけます。',
      status: canUseAdvancedAnalysis ? (hasAnalysisKey ? `${providerLabel}で利用可` : '追加分析の設定が必要') : '導入担当者が実行',
      tone: canUseAdvancedAnalysis ? (hasAnalysisKey ? 'ok' : 'need') : 'neutral',
      path: canUseAdvancedAnalysis ? '/compare' : '/analysis',
    },
    {
      icon: 'travel_explore',
      title: '競合になりそうなサイトを探す',
      term: '競合発見',
      description: '自社サイトを起点に、比較候補と見るべきポイントを集めます。',
      status: canUseAdvancedAnalysis ? (hasAnalysisKey ? `${providerLabel}で利用可` : '追加分析の設定が必要') : '導入担当者が実行',
      tone: canUseAdvancedAnalysis ? (hasAnalysisKey ? 'ok' : 'need') : 'neutral',
      path: canUseAdvancedAnalysis ? '/discovery' : '/analysis',
    },
    {
      icon: 'auto_fix_high',
      title: '広告画像の改善点を見つける',
      term: 'バナーレビュー',
      description: '画像の見やすさや伝わり方を確認し、修正案につなげます。',
      status: canUseAdvancedAnalysis ? (hasAnalysisKey ? `${providerLabel}で利用可` : '追加分析の設定が必要') : '導入担当者が実行',
      tone: canUseAdvancedAnalysis ? (hasAnalysisKey ? 'ok' : 'need') : 'neutral',
      path: canUseAdvancedAnalysis ? '/creative-review' : '/analysis',
    },
  ]

  const toneClass = {
    ok: 'bg-emerald-50 text-emerald-700',
    need: 'bg-amber-50 text-amber-700',
    demo: 'bg-sky-50 text-sky-700',
    neutral: 'bg-surface-container-high text-on-surface-variant',
  }

  return (
    <section className="motion-section-enter rounded-3xl bg-surface-container-lowest p-5 ring-1 ring-outline-variant/15 sm:p-7" aria-labelledby="today-feature-board-title">
      <div className="mb-5 flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:gap-6">
        <div>
          <p className="text-[11px] font-black tracking-[0.12em] text-secondary japanese-text">追加分析</p>
          <h2 id="today-feature-board-title" className="mt-1 text-2xl font-bold text-on-surface japanese-text">もっと詳しく調べる</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant japanese-text">
            {canUseAdvancedAnalysis
              ? '目的から選べば、そのまま分析を始められます。追加分析も、設定前から内容を確認できます。'
              : '自社サイトのレポートはそのまま利用できます。競合・画像分析は、先行導入中は担当者が安全に実行します。'}
          </p>
        </div>
        <Link
          to="/analysis"
          className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-primary/[0.07] px-4 py-2 text-sm font-black text-primary hover:bg-primary/[0.12] focus-visible:outline-2 focus-visible:outline-primary"
        >
          分析メニューを開く
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.title}
            to={item.path}
            className="motion-card group min-w-0 rounded-2xl bg-surface-container px-5 py-5 text-left hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/[0.08] text-primary" aria-hidden="true">
                <span className="material-symbols-outlined text-xl">{item.icon}</span>
              </span>
              <span className="material-symbols-outlined text-lg text-on-surface-variant transition-transform group-hover:translate-x-0.5" aria-hidden="true">arrow_forward</span>
            </span>
            <span className="mt-4 block text-base font-bold leading-6 text-on-surface japanese-text">{item.title}</span>
            <span className="mt-0.5 block text-xs font-bold text-on-surface-variant japanese-text">（{item.term}）</span>
            <span className="mt-3 block text-xs leading-5 text-on-surface-variant japanese-text">{item.description}</span>
            <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${toneClass[item.tone]}`}>
              {item.status}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function BeginnerDashboardHero({ setupState, reportBundle, isAdsAuthenticated, caseName }) {
  const lastCompletedAt = reportBundle?.generatedAt || setupState?.completedAt
  const latestLabel = lastCompletedAt
    ? new Date(lastCompletedAt).toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未更新'
  const hasDataset = Boolean(setupState?.datasetId)
  const hasCurrentReport = Boolean(
    reportBundle?.chartGroups?.length || reportBundle?.beginnerReport?.summary_cards?.length,
  )
  const hasPriorReport = hasCurrentReport || Boolean(setupState?.completedAt)
  const reportAction = resolveBeginnerReportAction({
    isAdsAuthenticated,
    hasDataset,
    hasReport: hasPriorReport,
  })
  const primaryPath = reportAction.path
  const primaryLabel = !hasCurrentReport && setupState?.completedAt
    ? '前回のレポートを再表示'
    : reportAction.label
  const progressItems = [
    { label: 'サイト計測をつなぐ', done: isAdsAuthenticated && hasDataset },
    { label: '見る期間を選ぶ', done: Boolean(setupState?.periods?.length) },
    { label: 'レポートを確認する', done: hasPriorReport },
  ]
  const sortedPeriods = [...(setupState?.periods ?? [])].sort((a, b) => String(a).localeCompare(String(b), 'ja'))
  const dateRange = sortedPeriods.length
    ? sortedPeriods.length === 1
      ? sortedPeriods[0]
      : `${sortedPeriods[0]} 〜 ${sortedPeriods[sortedPeriods.length - 1]}`
    : '期間未選択'

  return (
    <section className="motion-section-enter space-y-5" aria-labelledby="dashboard-primary-title">
      <div className="grid overflow-hidden rounded-3xl bg-primary text-on-primary shadow-sm lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div className="p-5 sm:p-7 lg:p-8">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-on-primary/70">
            {caseName || 'Webサイト分析'}
          </p>
          <h1 id="dashboard-primary-title" className="mt-2 max-w-3xl text-2xl font-black leading-tight japanese-text sm:text-3xl">
            {hasCurrentReport
              ? 'いまのサイトを、すぐ確認できます'
              : hasPriorReport
                ? '前回の条件から、すぐ再表示できます'
                : 'サイトの状態を、30秒でつかむ'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-on-primary/80 japanese-text">
            アクセス・来訪元・問い合わせ・改善するページを、初めて見る人にも分かる順番で表示します。
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              to={primaryPath}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent-gold px-6 py-3 text-sm font-black text-[#2a211c] shadow-sm hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {primaryLabel}
              <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_forward</span>
            </Link>
            {hasDataset && (
              <Link
                to="/ads/graphs"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-black text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                グラフを直接見る
                <span className="material-symbols-outlined text-base" aria-hidden="true">bar_chart</span>
              </Link>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black text-on-primary/75">
            <span className="rounded-full bg-white/10 px-3 py-1.5">対象: {dateRange}</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">最終更新: {latestLabel}</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">AIキーなしでも基本分析可</span>
          </div>
        </div>

        <figure className="relative min-h-32 overflow-hidden border-t border-white/10 sm:min-h-44 lg:min-h-full lg:border-l lg:border-t-0">
          <img
            src="/imagegen/beginner-analytics-collaboration.webp"
            alt=""
            width="1536"
            height="1024"
            loading="eager"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/5 to-transparent" />
          <figcaption className="absolute inset-x-0 bottom-0 p-4 text-xs font-black leading-5 text-white sm:p-5 japanese-text">
            難しい数字も、見る順番から案内します。
          </figcaption>
        </figure>
      </div>

      <ol className="grid gap-2 rounded-2xl bg-surface-container-lowest p-3 ring-1 ring-outline-variant/15 sm:grid-cols-3" aria-label="分析開始までの3ステップ">
        {progressItems.map((item, index) => (
          <li key={item.label} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-black ${item.done ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
              {item.done ? <span className="material-symbols-outlined text-base" aria-hidden="true">check</span> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-on-surface japanese-text">{item.label}</span>
              <span className="block text-[11px] font-bold text-on-surface-variant">{item.done ? '完了' : '次に進めます'}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['summarize', 'まとめを見る', '結論・判断保留・次にやること', hasDataset ? '/ads/report' : '/ads/wizard'],
          ['monitoring', 'グラフを見る', 'アクセス・来訪元・成果の根拠', hasDataset ? '/ads/graphs' : '/ads/wizard'],
          ['tune', '分析内容を変える', '見る項目と期間を選び直す', '/ads/wizard'],
          ['apps', '分析メニュー', 'AI・競合LP・広告画像を調べる', '/analysis'],
        ].map(([icon, title, body, path]) => (
          <Link
            key={title}
            to={path}
            className="motion-card flex min-h-24 items-center gap-4 rounded-2xl bg-surface-container-lowest px-5 py-4 text-left ring-1 ring-outline-variant/15 hover:bg-primary/[0.035] focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/[0.07] text-primary" aria-hidden="true">
              <span className="material-symbols-outlined">{icon}</span>
            </span>
            <span className="min-w-0">
              <strong className="block text-sm text-on-surface japanese-text">{title}</strong>
              <small className="mt-1 block text-xs font-bold leading-5 text-on-surface-variant japanese-text">{body}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const SUMMARY_TYPE_LABELS = {
  what_happened: '何が起きた',
  so_what: 'どう見るか',
  check_first: 'まず見る',
  data_gap: '判断保留',
  next_action: '次の一手',
}

function CurrentSiteSnapshot({ reportBundle }) {
  const report = reportBundle?.beginnerReport
  const cards = report?.summary_cards?.slice(0, 2) ?? []
  const action = report?.next_actions?.[0]
  const gap = report?.data_gaps?.[0]
  if (cards.length === 0 && !action && !gap) return null

  return (
    <section className="motion-section-enter space-y-4" aria-labelledby="current-site-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black tracking-[0.12em] text-secondary japanese-text">ひと目で確認</p>
          <h2 id="current-site-title" className="mt-1 text-2xl font-bold text-on-surface japanese-text">いまのサイト</h2>
        </div>
        <Link to="/ads/report" className="inline-flex min-h-11 items-center gap-1 text-sm font-black text-primary hover:underline">
          まとめをすべて見る
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <article key={`${card.type}-${index}`} className="rounded-2xl bg-surface-container-lowest p-5 ring-1 ring-outline-variant/15">
            <p className="text-[11px] font-black text-secondary">{SUMMARY_TYPE_LABELS[card.type] || 'サイトの変化'}</p>
            <h3 className="mt-2 text-base font-black leading-6 text-on-surface japanese-text">{card.title}</h3>
            <p className="mt-2 line-clamp-3 text-xs font-medium leading-6 text-on-surface-variant japanese-text">{card.body}</p>
          </article>
        ))}
        {action && (
          <article className="rounded-2xl bg-primary p-5 text-on-primary shadow-sm">
            <p className="text-[11px] font-black text-on-primary/70">次にやること</p>
            <h3 className="mt-2 text-base font-black leading-6 japanese-text">{action.title}</h3>
            {action.reason && <p className="mt-2 text-xs font-bold leading-6 text-on-primary/75 japanese-text">{action.reason}</p>}
          </article>
        )}
        {gap && (
          <article className="rounded-2xl bg-warning-container p-5 text-on-warning-container ring-1 ring-warning/20">
            <p className="text-[11px] font-black">まだ判断できないこと</p>
            <h3 className="mt-2 text-base font-black leading-6 japanese-text">{gap.label}</h3>
            {gap.impact && <p className="mt-2 text-xs font-bold leading-6 japanese-text">{gap.impact}</p>}
          </article>
        )}
      </div>
    </section>
  )
}

export default function Dashboard() {
  const { isAdsAuthenticated, hasAnalysisKey, analysisProvider, user } = useAuth()
  const canUseAdvancedAnalysis = user?.role === 'admin'
  const canLoadAdvancedHistory = canUseAdvancedAnalysis && hasAnalysisKey
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(canLoadAdvancedHistory)
  const [historyError, setHistoryError] = useState(null)
  const { setupState, reportBundle, currentCase } = useAdsSetup()
  const navigate = useNavigate()

  const fetchHistory = useCallback(() => {
    if (!canLoadAdvancedHistory) {
      setHistory([])
      setHistoryError(null)
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    getScans()
      .then((data) => {
        const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
        setHistory(items)
      })
      .catch((e) => {
        setHistoryError(e.message)
      })
      .finally(() => setHistoryLoading(false))
  }, [canLoadAdvancedHistory])

  useEffect(() => {
    if (!canLoadAdvancedHistory) return undefined

    let cancelled = false

    getScans()
      .then((data) => {
        if (cancelled) return
        const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
        setHistory(items)
      })
      .catch((e) => {
        if (cancelled) return
        setHistoryError(e.message)
      })
      .finally(() => {
        if (cancelled) return
        setHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [canLoadAdvancedHistory])

  const latestScan = history.length > 0 ? history[0] : null
  const latestDate = latestScan?.date ?? latestScan?.created_at ?? null
  const coreConnectionCount = [hasAnalysisKey, isAdsAuthenticated].filter(Boolean).length
  const adsAiStatusLabel = !isAdsAuthenticated
      ? '要認証'
      : !setupState
        ? '要セットアップ'
        : hasAnalysisKey
          ? `${getAnalysisProviderLabel(analysisProvider)} 詳細分析可`
          : 'キーなし整理可'

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-5 pb-4 sm:px-6 lg:px-8 lg:py-8">
      <BeginnerDashboardHero
        setupState={setupState}
        reportBundle={reportBundle}
        isAdsAuthenticated={isAdsAuthenticated}
        caseName={currentCase?.name || currentCase?.display_name}
      />

      <CurrentSiteSnapshot reportBundle={reportBundle} />

      {reportBundle?.chartGroups?.length > 0 && (
        <section className="motion-section-enter rounded-3xl bg-surface-container-lowest p-5 ring-1 ring-outline-variant/15 sm:p-7">
          <ChartOverviewSection
            chartGroups={reportBundle.chartGroups}
            periodTags={getChartPeriodTags(reportBundle.chartGroups)}
            onDrillDown={() => navigate('/ads/graphs')}
          />
        </section>
      )}

      <TodayFeatureBoard
        hasAnalysisKey={hasAnalysisKey}
        isAdsAuthenticated={isAdsAuthenticated}
        setupState={setupState}
        analysisProvider={analysisProvider}
        canUseAdvancedAnalysis={canUseAdvancedAnalysis}
      />

      <details className="motion-section-enter rounded-2xl bg-surface-container-lowest ring-1 ring-outline-variant/15">
        <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-5 py-4 font-extrabold text-on-surface japanese-text">
          最近の分析と接続状況を見る
          <span className="material-symbols-outlined text-primary" aria-hidden="true">expand_more</span>
        </summary>
        {/* Asymmetric two-column layout */}
        <div className="flex flex-col gap-6 border-t border-outline-variant/15 p-4 sm:p-5 xl:flex-row xl:gap-8">
        {/* ── Left data canvas ── */}
        <div className="flex-1 flex flex-col gap-8 min-w-0">
          {/* Stat Cards — grid-cols-3 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-6">
            {historyLoading ? (
              <>
                <div className="bg-surface-container-lowest p-6 rounded-[0.75rem]">
                  <SkeletonBlock variant="card" />
                </div>
                <div className="bg-surface-container-lowest p-6 rounded-[0.75rem]">
                  <SkeletonBlock variant="card" />
                </div>
                <div className="bg-surface-container-lowest p-6 rounded-[0.75rem]">
                  <SkeletonBlock variant="card" />
                </div>
              </>
            ) : (
              <>
                {history.length > 0 ? (
                  <LiveStatCard
                    icon="compare"
                    label="比較分析履歴数"
                    value={history.length.toLocaleString()}
                    unit="件"
                    subtitle={latestDate ? `最新: ${latestDate}` : undefined}
                    onClick={() => navigate('/compare')}
                  />
                ) : (
                  <EmptyStatCard
                    icon="compare"
                    label="比較分析履歴"
                    message="まだ分析がありません"
                    actionLabel="LP比較を始める"
                    onAction={() => navigate('/compare')}
                  />
                )}
                <LiveStatCard
                  icon="settings_suggest"
                  label="設定済みクエリ種別"
                  value={setupState?.queryTypes?.length ?? 0}
                  unit="種"
                  subtitle={setupState ? `${setupState.periods?.length ?? 0} 期間 / ${setupState.granularity ?? '-'}` : 'セットアップ未完了'}
                />
                <LiveStatCard
                  icon="key"
                  label="接続状況"
                  value={coreConnectionCount}
                  unit={`/ 2`}
                  subtitle={`競合・LP・画像分析: ${hasAnalysisKey ? `${getAnalysisProviderLabel(analysisProvider)}で利用可` : 'AIキーが必要'} / WebサイトAI: ${adsAiStatusLabel}`}
                />
              </>
            )}
          </div>

          {/* Recent Analysis Table */}
          <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover overflow-hidden">
            {/* Header bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <h3 className="text-lg font-bold text-on-surface japanese-text">最近の分析結果</h3>
              {history.length > 0 && (
                <button
                  onClick={() => navigate('/compare')}
                  className="text-sm font-bold text-secondary flex items-center gap-1 hover:underline"
                >
                  すべて表示
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              )}
            </div>
            {historyLoading ? (
              <div className="py-8 px-8 space-y-4">
                <SkeletonBlock variant="text" lines={5} />
              </div>
            ) : historyError ? (
              <div className="px-8 py-8">
                <div className="rounded-[0.75rem] bg-amber-50 border border-amber-200 px-5 py-4 text-amber-800 flex items-start gap-3">
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">history_toggle_off</span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold japanese-text">履歴取得だけ失敗。分析機能は利用可能です</p>
                    <p className="text-xs mt-1 japanese-text break-words">{historyError}</p>
                    <button
                      type="button"
                      onClick={fetchHistory}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-900 hover:underline"
                    >
                      履歴を再取得
                      <span className="material-symbols-outlined text-sm">sync</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-16 text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl text-outline-variant mb-2 block">history</span>
                <p className="text-sm japanese-text">分析履歴がまだありません</p>
                <button
                  onClick={() => navigate('/compare')}
                  className="mt-4 text-sm font-bold text-secondary hover:underline flex items-center gap-1 mx-auto"
                >
                  LP比較分析を始める
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container text-on-surface-variant">
                    <th className="py-4 px-6 font-bold text-xs uppercase tracking-wider japanese-text">案件名</th>
                    <th className="py-4 px-6 font-bold text-xs uppercase tracking-wider">URL</th>
                    <th className="py-4 px-6 font-bold text-xs uppercase tracking-wider">更新日</th>
                    <th className="py-4 px-6 font-bold text-xs uppercase tracking-wider">スコア</th>
                    <th className="py-4 px-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 10).map((item, i) => (
                    <tr key={item.id ?? i} className="hover:bg-surface-container-low transition-colors group">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant">
                            <span className="material-symbols-outlined text-lg">web</span>
                          </div>
                          <span className="font-bold text-on-surface japanese-text">{item.name ?? item.title ?? `分析 #${i + 1}`}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm text-on-surface-variant truncate max-w-[180px]">{item.url ?? item.urls?.[0] ?? '-'}</td>
                      <td className="py-4 px-6 text-sm text-on-surface-variant tabular-nums">{item.date ?? item.created_at ?? '-'}</td>
                      <td className="py-4 px-6">
                        {item.score != null ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-on-surface tabular-nums">{item.score}</span>
                            <div className="w-20 h-2 bg-surface-container rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, item.score)}%` }} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-on-surface-variant">--</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-success-container text-emerald-700 dark:text-on-success-container">完了</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* ── Right sidebar actions (w-[280px]) ── */}
        <div className="flex w-full flex-col gap-6 xl:w-[280px] xl:shrink-0">
          {/* Quick Actions Card */}
          <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] ghost-border">
            <h4 className="text-sm font-bold text-on-surface-variant mb-4 japanese-text">クイックアクション</h4>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => navigate('/compare')}
                className="button-primary w-full justify-center"
              >
                <span className="material-symbols-outlined text-lg">bolt</span>
                新規LP比較
              </button>
              <button
                onClick={() => navigate('/creative-review')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-on-surface border border-outline-variant/30 hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-lg">auto_fix_high</span>
                クリエイティブ診断
              </button>
              <button
                onClick={() => navigate('/ads/wizard')}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-lg">settings</span>
                レポート設定
              </button>
            </div>
          </div>

          <SetupStatusCard
            setupState={setupState}
            reportBundle={reportBundle}
            isAdsAuthenticated={isAdsAuthenticated}
            onNavigate={navigate}
          />
        </div>
        </div>
      </details>
    </div>
  )
}
