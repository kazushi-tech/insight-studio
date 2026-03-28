import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Chart from 'chart.js/auto'
import { getScans } from '../api/marketLens'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useAuth } from '../contexts/AuthContext'
import { getChartPeriodTags, getDisplayChartGroups, isMeaningfulChartGroup } from '../utils/adsReports'
import { SkeletonBlock, ErrorBanner } from '../components/ui'

function LiveStatCard({ icon, label, value, unit, subtitle, onClick }) {
  return (
    <div
      className={`bg-surface-container-lowest p-6 rounded-[0.75rem] ghost-border panel-card-hover flex flex-col gap-4 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center text-gold">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div>
        <p className="text-on-surface-variant text-sm font-bold japanese-text">{label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-3xl font-bold text-primary tabular-nums">{value}</span>
          {unit && <span className="text-sm text-on-surface-variant font-medium">{unit}</span>}
        </div>
      </div>
      {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
    </div>
  )
}

function EmptyStatCard({ icon, label, message, actionLabel, onAction }) {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] ghost-border panel-card-hover flex flex-col gap-4">
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
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []

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
      className="bg-surface-container-lowest p-5 rounded-[0.75rem] panel-card-hover cursor-pointer"
      onClick={onClick}
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
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-bold text-on-surface japanese-text">広告データ概要</h3>
        <div className="flex items-center gap-3">
          <select
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
            すべてのグラフ
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
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
          <div className="w-10 h-10 rounded-[0.75rem] bg-amber-50 flex items-center justify-center text-amber-600">
            <span className="material-symbols-outlined">lock</span>
          </div>
          <h4 className="text-lg font-bold japanese-text">広告考察</h4>
        </div>
        <p className="text-sm text-on-surface-variant">考察スタジオへの認証が必要です。サイドバーの API キー設定からログインしてください。</p>
      </div>
    )
  }

  if (!setupState) {
    return (
      <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card-hover">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-[0.75rem] bg-amber-50 flex items-center justify-center text-amber-600">
            <span className="material-symbols-outlined">settings_suggest</span>
          </div>
          <h4 className="text-lg font-bold japanese-text">広告考察セットアップ</h4>
        </div>
        <p className="text-sm text-on-surface-variant mb-3">セットアップを完了すると、要点パック・グラフ・AI考察が利用できます。</p>
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
        <div className="w-10 h-10 rounded-[0.75rem] bg-emerald-50 flex items-center justify-center text-emerald-600">
          <span className="material-symbols-outlined">check_circle</span>
        </div>
        <h4 className="text-lg font-bold japanese-text">広告考察セットアップ</h4>
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
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onNavigate('/ads/pack')}
          className="flex-1 py-2 text-sm font-bold text-secondary hover:bg-secondary/5 rounded-lg transition-colors text-center"
        >
          要点パック
        </button>
        <button
          onClick={() => onNavigate('/ads/graphs')}
          className="flex-1 py-2 text-sm font-bold text-secondary hover:bg-secondary/5 rounded-lg transition-colors text-center"
        >
          グラフ
        </button>
        <button
          onClick={() => onNavigate('/ads/ai')}
          className="flex-1 py-2 text-sm font-bold text-secondary hover:bg-secondary/5 rounded-lg transition-colors text-center"
        >
          AI考察
        </button>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const { setupState, reportBundle } = useAdsSetup()
  const { isAdsAuthenticated, hasGeminiKey } = useAuth()
  const navigate = useNavigate()

  const fetchHistory = () => {
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
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const latestScan = history.length > 0 ? history[0] : null
  const latestDate = latestScan?.date ?? latestScan?.created_at ?? null

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-12">
      {/* Welcome Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-on-surface tracking-tight japanese-text">ダッシュボード</h2>
          <p className="text-on-surface-variant mt-2 text-lg">現在の分析状況の概要です</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => navigate('/compare')}
            className="button-primary"
          >
            <span className="material-symbols-outlined text-lg">bolt</span>
            新規LP比較
          </button>
        </div>
      </div>

      {/* Live Status Cards */}
      <div className="grid grid-cols-3 gap-8">
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
              label="API接続状況"
              value={[hasGeminiKey, isAdsAuthenticated].filter(Boolean).length}
              unit={`/ 2 接続`}
              subtitle={`Gemini: ${hasGeminiKey ? '設定済' : '未設定'} / 考察: ${isAdsAuthenticated ? '接続済' : '未接続'}`}
            />
          </>
        )}
      </div>

      {/* Recent Analysis Results */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold text-on-surface japanese-text">最近の分析結果</h3>
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
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover overflow-hidden">
          {historyLoading ? (
            <div className="py-8 px-8 space-y-4">
              <SkeletonBlock variant="text" lines={5} />
            </div>
          ) : historyError ? (
            <div className="px-8 py-6">
              <ErrorBanner message={historyError} onRetry={fetchHistory} />
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container text-on-surface-variant">
                  <th className="py-5 px-8 font-bold text-xs uppercase tracking-wider japanese-text">案件名</th>
                  <th className="py-5 px-8 font-bold text-xs uppercase tracking-wider">URL</th>
                  <th className="py-5 px-8 font-bold text-xs uppercase tracking-wider">更新日</th>
                  <th className="py-5 px-8 font-bold text-xs uppercase tracking-wider">スコア</th>
                  <th className="py-5 px-8"></th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((item, i) => (
                  <tr key={item.id ?? i} className="hover:bg-surface-container-low transition-colors group">
                    <td className="py-5 px-8">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant">
                          <span className="material-symbols-outlined text-lg">web</span>
                        </div>
                        <span className="font-bold text-on-surface japanese-text">{item.name ?? item.title ?? `分析 #${i + 1}`}</span>
                      </div>
                    </td>
                    <td className="py-5 px-8 text-sm text-on-surface-variant truncate max-w-[200px]">{item.url ?? item.urls?.[0] ?? '-'}</td>
                    <td className="py-5 px-8 text-sm text-on-surface-variant tabular-nums">{item.date ?? item.created_at ?? '-'}</td>
                    <td className="py-5 px-8">
                      {item.score != null ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {item.score}
                        </span>
                      ) : (
                        <span className="text-sm text-on-surface-variant">--</span>
                      )}
                    </td>
                    <td className="py-5 px-8 text-right">
                      <button className="w-10 h-10 rounded-lg hover:bg-surface-container flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-all">
                        <span className="material-symbols-outlined">more_vert</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Chart Overview (GA-like compact charts from reportBundle) */}
      {reportBundle?.chartGroups?.length > 0 && (
        <ChartOverviewSection
          chartGroups={reportBundle.chartGroups}
          periodTags={getChartPeriodTags(reportBundle.chartGroups)}
          onDrillDown={() => navigate('/ads/graphs')}
        />
      )}

      {/* Bottom Section: Setup Status + Creative Review CTA */}
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-5">
          <SetupStatusCard
            setupState={setupState}
            reportBundle={reportBundle}
            isAdsAuthenticated={isAdsAuthenticated}
            onNavigate={navigate}
          />
        </div>
        <div className="col-span-7 bg-primary-container p-8 rounded-[0.75rem] flex flex-col justify-between overflow-hidden relative h-[280px]">
          <div className="relative z-10">
            <h4 className="text-2xl font-black text-white japanese-text">AI 広告クリエイティブ診断</h4>
            <p className="text-white/60 mt-2 max-w-md">
              最新のAIモデルが広告クリエイティブとLPの連動性を分析し、改善バナーを自動生成します。
            </p>
            <button
              onClick={() => navigate('/creative-review')}
              className="button-primary mt-8"
            >
              診断を始める
              <span className="material-symbols-outlined">east</span>
            </button>
          </div>
          <div className="absolute right-0 top-0 h-full w-1/2 opacity-10 bg-gradient-to-l from-gold/30 to-transparent" />
        </div>
      </div>
    </div>
  )
}
