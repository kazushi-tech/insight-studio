import { useState, useEffect } from 'react'
import { getScans } from '../api/marketLens'

const STAT_CARDS = [
  {
    icon: 'web',
    label: '分析済みLP数',
    value: '1,240',
    unit: '件',
    badge: '先月比 +12%',
    badgeType: 'positive',
    bars: [40, 60, 30, 70, 90, 80, 100],
  },
  {
    icon: 'history_edu',
    label: '今月の考察数',
    value: '45',
    unit: '件',
    badge: '先月比 +5件',
    badgeType: 'positive',
    bars: [20, 40, 35, 55, 75, 65, 95],
  },
  {
    icon: 'payments',
    label: '最新CPA',
    value: '¥2,450',
    unit: '',
    badge: '先月比 -¥120',
    badgeType: 'negative',
    bars: [80, 70, 90, 60, 40, 30, 25],
  },
]

const TREND_KEYWORDS = ['#パーソナライズ', '#D2C戦略', '#動画LP', '#サブスクリプション']

function StatCard({ card }) {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-[16px] shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] flex flex-col gap-4 group">
      <div className="flex justify-between items-start">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary">
          <span className="material-symbols-outlined">{card.icon}</span>
        </div>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${
            card.badgeType === 'negative'
              ? 'text-error bg-error-container/20'
              : 'text-secondary bg-secondary-container/20'
          }`}
        >
          {card.badge}
        </span>
      </div>
      <div>
        <p className="text-on-surface-variant text-sm font-bold japanese-text">{card.label}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-4xl font-black text-primary tabular-nums">{card.value}</span>
          {card.unit && <span className="text-sm text-on-surface-variant font-medium">{card.unit}</span>}
        </div>
      </div>
      <div className="h-12 w-full mt-2 flex items-end gap-[2px]">
        {card.bars.map((h, i) => (
          <div
            key={i}
            className={`w-full rounded-t-sm transition-colors ${
              i >= card.bars.length - 3
                ? 'bg-secondary'
                : 'bg-secondary/20 group-hover:bg-secondary/40'
            }`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)

  useEffect(() => {
    getScans()
      .then((data) => {
        const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
        setHistory(items)
      })
      .catch((e) => {
        if (e.status === 404) {
          setHistory([])
          setHistoryError(null)
          return
        }
        setHistoryError(e.message)
      })
      .finally(() => setHistoryLoading(false))
  }, [])

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-12">
      {/* Welcome Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">ダッシュボード</h2>
          <p className="text-on-surface-variant mt-2 text-lg">現在の分析状況と主要メトリクスの概要です</p>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-3 bg-white text-primary border border-outline-variant/50 rounded-xl font-bold flex items-center gap-2 hover:bg-surface-container transition-all text-sm">
            <span className="material-symbols-outlined text-lg">ios_share</span>
            レポート出力
          </button>
          <button className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm">
            <span className="material-symbols-outlined text-lg">bolt</span>
            新規分析
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-8">
        {STAT_CARDS.map((card) => (
          <StatCard key={card.label} card={card} />
        ))}
      </div>

      {/* Recent Analysis Results */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text">最近の分析結果</h3>
          <button className="text-sm font-bold text-secondary flex items-center gap-1 hover:underline">
            すべて表示
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] overflow-hidden">
          {historyLoading ? (
            <div className="flex items-center justify-center py-16 text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              読み込み中…
            </div>
          ) : historyError ? (
            <div className="flex items-center gap-3 px-8 py-6 text-sm text-red-700">
              <span className="material-symbols-outlined">error</span>
              <span>{historyError}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl text-outline-variant mb-2 block">history</span>
              <p className="text-sm japanese-text">分析履歴がまだありません</p>
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
              <tbody className="divide-y divide-surface-container/50">
                {history.map((item, i) => (
                  <tr key={item.id ?? i} className="hover:bg-surface-container-low transition-colors group">
                    <td className="py-5 px-8">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant">
                          <span className="material-symbols-outlined text-lg">web</span>
                        </div>
                        <span className="font-bold text-[#1A1A2E] japanese-text">{item.name ?? item.title ?? `分析 #${i + 1}`}</span>
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
                      <button className="w-10 h-10 rounded-lg hover:bg-white flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-all">
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

      {/* Bento Section */}
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-8 bg-surface-container p-8 rounded-2xl flex flex-col justify-between overflow-hidden relative group h-[320px]">
          <div className="relative z-10">
            <h4 className="text-2xl font-black text-primary japanese-text">AI 広告クリエイティブ診断</h4>
            <p className="text-on-surface-variant mt-2 max-w-md">
              最新のAIモデルが競合他社の広告クリエイティブとLPの連動性を分析し、独自の最適化案を提示します。
            </p>
            <button className="mt-8 px-6 py-3 bg-primary text-on-primary rounded-xl font-bold transition-all hover:translate-x-1 flex items-center gap-2 text-sm">
              詳細を見る
              <span className="material-symbols-outlined">east</span>
            </button>
          </div>
          <div className="absolute right-0 top-0 h-full w-1/2 opacity-20 group-hover:opacity-30 transition-opacity bg-gradient-to-l from-primary-container/30 to-transparent" />
        </div>
        <div className="col-span-4 bg-secondary p-8 rounded-2xl flex flex-col justify-between text-on-secondary shadow-xl shadow-secondary/10">
          <div>
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-6">
              <span className="material-symbols-outlined">auto_awesome</span>
            </div>
            <h4 className="text-2xl font-bold leading-tight japanese-text">今週のトレンドキーワード</h4>
            <div className="mt-6 flex flex-wrap gap-2">
              {TREND_KEYWORDS.map((kw) => (
                <span key={kw} className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold">
                  {kw}
                </span>
              ))}
            </div>
          </div>
          <p className="text-sm text-white/80 mt-4 italic">※競合150社の分析結果に基づく抽出</p>
        </div>
      </div>
    </div>
  )
}
