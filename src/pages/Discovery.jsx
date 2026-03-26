import { useState } from 'react'

const MOCK_DISCOVERIES = [
  { name: '自然派コスメ A社', score: 94, updatedAt: '2時間前に更新' },
  { name: '高機能バックパック B社', score: 88, updatedAt: '5時間前に更新' },
  { name: '転職支援サイト C社', score: 91, updatedAt: '12時間前に更新' },
  { name: '都市型マンション 不動産D社', score: 82, updatedAt: '1日前に更新' },
]

export default function Discovery() {
  const [url, setUrl] = useState('')

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">Discovery Hub</h2>
        <p className="text-on-surface-variant mt-2 text-lg">URLを入力するだけで、市場の競合他社とそのパフォーマンスを瞬時に可視化します。</p>
      </div>

      {/* URL Input */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">link</span>
          <input
            className="w-full bg-surface-container-lowest rounded-xl py-4 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40 transition-all shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)]"
            placeholder="競合他社のURLを入力"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button className="px-8 py-4 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm">
          <span className="material-symbols-outlined">search</span>
          競合を発見
        </button>
      </div>

      {/* Discovered LPs */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold text-[#1A1A2E] flex items-center gap-2 japanese-text">
            <span className="material-symbols-outlined text-secondary">verified</span>
            発見されたLP一覧
          </h3>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-surface-container rounded-lg text-sm font-bold text-on-surface hover:bg-surface-container-high transition-colors">
              MOST RECENT
            </button>
            <button className="px-4 py-2 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors">
              HIGHEST SCORE
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {MOCK_DISCOVERIES.map((item) => (
            <div
              key={item.name}
              className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] overflow-hidden group"
            >
              <div className="h-48 bg-surface-container relative">
                <span className="material-symbols-outlined absolute inset-0 m-auto text-6xl text-outline-variant/50">
                  web
                </span>
                <div className="absolute top-3 right-3 bg-surface-container-lowest/90 backdrop-blur px-3 py-1 rounded-lg">
                  <span className="text-xs font-bold text-on-surface-variant">SCORE</span>{' '}
                  <span className="text-lg font-black text-secondary tabular-nums">{item.score}</span>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-[#1A1A2E] japanese-text">{item.name}</h4>
                  <button className="text-on-surface-variant hover:text-primary transition-colors">
                    <span className="material-symbols-outlined text-lg">open_in_new</span>
                  </button>
                </div>
                <p className="text-xs text-on-surface-variant mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">schedule</span>
                  {item.updatedAt}
                </p>
                <button className="mt-4 w-full py-2.5 border border-outline-variant/50 rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container transition-all flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-sm">analytics</span>
                  分析する
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
