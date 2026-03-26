import { useState } from 'react'
import { generateInsights } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

const NAV_ITEMS = ['サマリー', 'トラフィック', 'コンバージョン', 'ROI分析']

const FALLBACK_SECTIONS = [
  {
    icon: 'grid_view',
    title: '全体サマリー',
    subtitle: '主要指標の概況と前月比推移',
    metrics: [
      { label: '総表示回数', value: '1,240,500', change: '+8.2%' },
      { label: 'クリック数', value: '45,230', change: '+12.4%' },
      { label: '総コスト', value: '¥842,000', tag: '安定' },
    ],
  },
  {
    icon: 'person',
    title: 'トラフィック分析',
    subtitle: 'デバイス別・時間帯別の流入傾向',
    devices: [
      { label: 'スマートフォン', value: 78, color: 'bg-secondary' },
      { label: 'PC', value: 18, color: 'bg-primary' },
      { label: 'タブレット', value: 4, color: 'bg-tertiary' },
    ],
  },
  {
    icon: 'conversion_path',
    title: 'コンバージョン考察',
    subtitle: '成果に繋がったキーワードとクリエイティブの分析',
    table: [
      { name: 'リターゲティング_秋CP', cv: 124, cvr: '3.2%', cpa: '¥1,200' },
      { name: '新規獲得_ディスプレイ', cv: 58, cvr: '1.1%', cpa: '¥2,450' },
    ],
  },
  {
    icon: 'attach_money',
    title: 'ROI・費用対効果',
    subtitle: '投資に対する利益率の算出と将来予測',
  },
]

function normalizeSections(rawSections) {
  const sections = Array.isArray(rawSections) ? rawSections : []

  return [
    {
      ...FALLBACK_SECTIONS[0],
      ...sections[0],
      metrics:
        Array.isArray(sections[0]?.metrics) && sections[0].metrics.length > 0
          ? sections[0].metrics
          : FALLBACK_SECTIONS[0].metrics,
    },
    {
      ...FALLBACK_SECTIONS[1],
      ...sections[1],
      devices:
        Array.isArray(sections[1]?.devices) && sections[1].devices.length > 0
          ? sections[1].devices
          : FALLBACK_SECTIONS[1].devices,
    },
    {
      ...FALLBACK_SECTIONS[2],
      ...sections[2],
      table:
        Array.isArray(sections[2]?.table) && sections[2].table.length > 0
          ? sections[2].table
          : FALLBACK_SECTIONS[2].table,
    },
    {
      ...FALLBACK_SECTIONS[3],
      ...sections[3],
    },
  ]
}

export default function EssentialPack() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState } = useAdsSetup()
  const [activeNav, setActiveNav] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [insights, setInsights] = useState(null)

  async function handleGenerate() {
    setError(null)
    setLoading(true)
    try {
      const data = await generateInsights({
        type: 'essential_pack',
        ...(setupState && {
          query_types: setupState.queryTypes,
          periods: setupState.periods,
          granularity: setupState.granularity,
        }),
      })
      setInsights(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const report = insights?.report ?? insights?.analysis ?? insights?.content ?? null
  const displaySections = normalizeSections(insights?.sections)

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Left Panel */}
      <div className="w-[280px] bg-surface-container-lowest border-r border-surface-container p-6 space-y-6">
        <div>
          <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">分析期間</label>
          <div className="mt-2 space-y-1">
            {setupState?.periods?.length > 0 ? (
              setupState.periods.map((p) => (
                <div key={p} className="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-xl text-sm">
                  <span className="material-symbols-outlined text-sm text-secondary">calendar_today</span>
                  <span>{p}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-on-surface-variant px-4 py-2">セットアップ未完了</p>
            )}
          </div>
        </div>
        {setupState && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">分析条件</label>
            <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
              <p>粒度: {setupState.granularity === 'monthly' ? '月別' : setupState.granularity === 'weekly' ? '週別' : '日別'}</p>
              <p>クエリ: {setupState.queryTypes?.join(', ')}</p>
            </div>
          </div>
        )}
        <div>
          <h4 className="text-sm font-bold text-[#1A1A2E] mb-3 japanese-text">レポート構成</h4>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item, i) => (
              <button
                key={item}
                onClick={() => setActiveNav(i)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all text-left ${
                  i === activeNav
                    ? 'bg-secondary/10 text-secondary font-bold'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-lg">
                  {['grid_view', 'public', 'conversion_path', 'monetization_on'][i]}
                </span>
                {item}
              </button>
            ))}
          </nav>
        </div>
        {!isAdsAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !isAdsAuthenticated}
          className="w-full py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              生成中…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">smart_toy</span>
              AI考察を生成
            </>
          )}
        </button>

        {insights && (
          <div className="bg-secondary p-5 rounded-2xl text-on-secondary">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined">smart_toy</span>
              <span className="font-bold text-sm">AI INSIGHT</span>
            </div>
            <p className="text-sm leading-relaxed">
              {insights?.summary ?? insights?.ai_insight ?? '考察レポートが生成されました。'}
            </p>
          </div>
        )}
      </div>

      {/* Right Content */}
      <div className="flex-1 p-8 space-y-8 overflow-y-auto">
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
            <span className="material-symbols-outlined text-lg">error</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-extrabold text-[#1A1A2E] japanese-text">広告考察レポート</h2>
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-white border border-outline-variant/50 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-surface-container transition-all">
              <span className="material-symbols-outlined text-lg">download</span>
              レポート出力
            </button>
            <button className="px-4 py-2 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all">
              <span className="material-symbols-outlined text-lg">share</span>
              共有
            </button>
          </div>
        </div>

        {/* Summary Section */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <div className="flex items-center gap-3 cursor-pointer">
            <span className="material-symbols-outlined text-secondary">grid_view</span>
            <div>
              <h3 className="text-xl font-bold japanese-text">全体サマリー</h3>
              <p className="text-sm text-on-surface-variant">主要指標の概況と前月比推移</p>
            </div>
            <span className="material-symbols-outlined ml-auto text-on-surface-variant">expand_less</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {displaySections[0].metrics.map((m) => (
              <div key={m.label} className="bg-surface-container rounded-xl p-4">
                <p className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">{m.label}</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black tabular-nums text-primary">{m.value}</span>
                  {m.change && <span className="text-sm font-bold text-secondary">↑{m.change}</span>}
                  {m.tag && <span className="text-xs px-2 py-0.5 bg-surface-container-high rounded font-bold">{m.tag}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Traffic Section */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary">person</span>
            <div>
              <h3 className="text-xl font-bold japanese-text">トラフィック分析</h3>
              <p className="text-sm text-on-surface-variant">デバイス別・時間帯別の流入傾向</p>
            </div>
            <span className="material-symbols-outlined ml-auto text-on-surface-variant">expand_more</span>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-bold japanese-text">デバイス比率</p>
            {displaySections[1].devices.map((d) => (
              <div key={d.label} className="flex items-center gap-4">
                <span className="text-sm w-32 japanese-text">{d.label}</span>
                <div className="flex-1 h-3 bg-surface-container rounded-full overflow-hidden">
                  <div className={`h-full ${d.color} rounded-full`} style={{ width: `${d.value}%` }} />
                </div>
                <span className="text-sm font-bold tabular-nums w-12 text-right">{d.value}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion Section */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary">conversion_path</span>
            <div>
              <h3 className="text-xl font-bold japanese-text">コンバージョン考察</h3>
              <p className="text-sm text-on-surface-variant">成果に繋がったキーワードとクリエイティブの分析</p>
            </div>
            <span className="material-symbols-outlined ml-auto text-on-surface-variant">expand_more</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-on-surface-variant border-b border-surface-container">
                <th className="py-3 text-left font-bold">広告セット名</th>
                <th className="py-3 text-right font-bold">CV数</th>
                <th className="py-3 text-right font-bold">CVR</th>
                <th className="py-3 text-right font-bold">CPA</th>
              </tr>
            </thead>
            <tbody>
              {displaySections[2].table.map((row) => (
                <tr key={row.name} className="border-b border-surface-container/50">
                  <td className="py-3 font-bold japanese-text">{row.name}</td>
                  <td className="py-3 text-right tabular-nums">{row.cv}</td>
                  <td className="py-3 text-right tabular-nums">{row.cvr}</td>
                  <td className="py-3 text-right tabular-nums">{row.cpa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ROI Section */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary">attach_money</span>
            <div>
              <h3 className="text-xl font-bold japanese-text">ROI・費用対効果</h3>
              <p className="text-sm text-on-surface-variant">投資に対する利益率の算出と将来予測</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-primary-container p-6 rounded-2xl text-on-primary">
              <p className="text-xs uppercase tracking-wider font-bold opacity-80">現在のROAS</p>
              <div className="text-5xl font-black mt-2 tabular-nums text-white">450<span className="text-2xl">%</span></div>
              <p className="text-sm mt-2 text-secondary-fixed-dim">↗ 目標値（400%）を達成中</p>
            </div>
            <div className="bg-surface-container rounded-2xl p-6">
              <p className="text-sm text-on-surface-variant leading-relaxed japanese-text">
                今期はリターゲティング広告の精度向上により、広告費あたりの売上が前年同期比で15%向上しました。次月はさらに予算配分を最適化する余地があります。
              </p>
            </div>
          </div>
        </div>

        {/* AI Generated Report */}
        {report && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">auto_awesome</span>
              <div>
                <h3 className="text-xl font-bold japanese-text">AI生成レポート</h3>
                <p className="text-sm text-on-surface-variant">考察スタジオが生成した分析結果</p>
              </div>
            </div>
            <div className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap japanese-text">{report}</div>
          </div>
        )}
      </div>
    </div>
  )
}
