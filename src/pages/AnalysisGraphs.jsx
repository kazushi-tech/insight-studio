import { useState, useEffect } from 'react'
import { loadData } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'

const FALLBACK_CREATIVES = [
  { name: '2024_Spring_Banner_01', network: 'Google Display Network', impr: '452,001', clicks: '12,431', ctr: '2.75%', cv: 184, status: '配信中', statusColor: 'emerald' },
  { name: 'Retargeting_Video_Short', network: 'Instagram Stories', impr: '231,988', clicks: '5,102', ctr: '2.20%', cv: 92, status: '停止中', statusColor: 'slate' },
]

const FALLBACK_ROI = [
  { name: '春の特大セール A', value: 342 },
  { name: 'SNS限定キャンペーン', value: 218 },
  { name: 'リターゲティング広告', value: 184 },
  { name: 'リスティング(指名）', value: 156 },
]

export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isAdsAuthenticated) return
    setLoading(true)
    loadData({ type: 'graphs' })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAdsAuthenticated])

  const creatives = data?.creatives ?? FALLBACK_CREATIVES
  const roiRanking = data?.roi_ranking ?? FALLBACK_ROI

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">広告パフォーマンス分析グラフ</h2>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">総インプレッション</p>
            <p className="text-2xl font-black tabular-nums text-primary">1,284,092</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">平均CTR</p>
            <p className="text-2xl font-black tabular-nums text-secondary">2.48%</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
          データを読み込み中…
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4">
        <div className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30 text-sm flex items-center gap-2">
          <span className="text-on-surface-variant">期間:</span>
          <span className="font-bold">直近30日間</span>
          <span className="material-symbols-outlined text-sm text-on-surface-variant">expand_more</span>
        </div>
        <div className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30 text-sm flex items-center gap-2">
          <span className="text-on-surface-variant">チャネル:</span>
          <span className="font-bold">すべての広告</span>
          <span className="material-symbols-outlined text-sm text-on-surface-variant">expand_more</span>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-2 gap-8">
        {/* CTR Chart */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="text-lg font-bold">CTR推移</h3>
              <p className="text-xs text-on-surface-variant">日次クリック率の変動</p>
            </div>
            <button className="text-on-surface-variant hover:text-primary"><span className="material-symbols-outlined">more_vert</span></button>
          </div>
          <div className="h-48 flex items-end justify-around gap-1 mt-4">
            {/* Simplified line chart placeholder */}
            <svg viewBox="0 0 300 120" className="w-full h-full">
              <polyline
                fill="none"
                stroke="#D4A843"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points="10,90 60,70 110,40 160,55 210,30 260,45 290,35"
              />
              <polyline
                fill="none"
                stroke="#D4A843"
                strokeWidth="0"
                opacity="0.1"
                points="10,120 10,90 60,70 110,40 160,55 210,30 260,45 290,35 290,120"
              />
              {/* Fill */}
              <polygon
                fill="#D4A843"
                opacity="0.1"
                points="10,120 10,90 60,70 110,40 160,55 210,30 260,45 290,35 290,120"
              />
            </svg>
          </div>
          <div className="flex justify-between text-xs text-on-surface-variant mt-2 px-2">
            {['01 Jan', '08 Jan', '15 Jan', '22 Jan', '29 Jan'].map((d) => <span key={d}>{d}</span>)}
          </div>
        </div>

        {/* Conversions Bar Chart */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="text-lg font-bold">コンバージョン数</h3>
              <p className="text-xs text-on-surface-variant">週次の成果発生推移</p>
            </div>
            <button className="text-on-surface-variant hover:text-primary"><span className="material-symbols-outlined">more_vert</span></button>
          </div>
          <div className="h-48 flex items-end justify-around gap-3 mt-4 px-4">
            {[45, 52, 48, 72, 85].map((v, i) => (
              <div key={i} className="flex flex-col items-center gap-2 flex-1">
                <div
                  className={`w-full rounded-t-lg ${i >= 3 ? 'bg-secondary' : 'bg-secondary/30'}`}
                  style={{ height: `${(v / 85) * 100}%` }}
                />
                <span className="text-xs text-on-surface-variant">第{i + 1}週</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROI & Demographics */}
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold">ROIランキング</h3>
              <p className="text-xs text-on-surface-variant">キャンペーン別投資対効果</p>
            </div>
            <button className="text-on-surface-variant hover:text-primary"><span className="material-symbols-outlined">tune</span></button>
          </div>
          <div className="space-y-4">
            {roiRanking.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="japanese-text">{item.name}</span>
                  <span className="font-bold tabular-nums">{item.value}%</span>
                </div>
                <div className="h-2.5 bg-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-secondary rounded-full" style={{ width: `${(item.value / 350) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold">デモグラフィック分析</h3>
              <p className="text-xs text-on-surface-variant">年齢層別のアプローチ比率</p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-8 h-48">
            {/* Donut Chart Placeholder */}
            <div className="w-36 h-36 rounded-full border-[16px] border-secondary relative flex items-center justify-center"
              style={{ borderColor: '#D4A843', borderTopColor: '#1A1A2E', borderRightColor: '#695d3c' }}>
              <div className="text-center">
                <p className="text-2xl font-black">100%</p>
                <p className="text-xs text-on-surface-variant">合計分布</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { label: '20代 - 30代', value: '45% (構成比)', color: 'bg-secondary' },
                { label: '40代 - 50代', value: '35% (構成比)', color: 'bg-primary' },
                { label: 'その他', value: '20% (構成比)', color: 'bg-tertiary' },
              ].map((d) => (
                <div key={d.label} className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${d.color}`} />
                  <div>
                    <p className="text-sm font-bold">{d.label}</p>
                    <p className="text-xs text-on-surface-variant">{d.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Creatives Table */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold japanese-text">クリエイティブ別詳細データ</h3>
          <button className="px-4 py-2 border border-outline-variant/50 rounded-xl text-sm font-bold hover:bg-surface-container transition-all">
            CSVエクスポート
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-on-surface-variant border-b border-surface-container">
              <th className="py-3 text-left font-bold">クリエイティブ名</th>
              <th className="py-3 text-right font-bold">インプレッション</th>
              <th className="py-3 text-right font-bold">クリック数</th>
              <th className="py-3 text-right font-bold">CTR</th>
              <th className="py-3 text-right font-bold">CV数</th>
              <th className="py-3 text-right font-bold">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {creatives.map((c) => (
              <tr key={c.name} className="border-b border-surface-container/50 hover:bg-surface-container-low transition-colors">
                <td className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center">
                      <span className="material-symbols-outlined text-sm">image</span>
                    </div>
                    <div>
                      <p className="font-bold">{c.name}</p>
                      <p className="text-xs text-on-surface-variant">{c.network}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 text-right tabular-nums">{c.impr}</td>
                <td className="py-4 text-right tabular-nums">{c.clicks}</td>
                <td className="py-4 text-right tabular-nums text-secondary font-bold">{c.ctr}</td>
                <td className="py-4 text-right tabular-nums">{c.cv}</td>
                <td className="py-4 text-right">
                  <span className={`px-3 py-1 rounded-lg text-xs font-bold bg-${c.statusColor}-100 text-${c.statusColor}-700`}>
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
