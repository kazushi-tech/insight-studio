import { useState } from 'react'

const QUERY_TYPES = [
  { icon: 'trending_up', label: 'PV分析', desc: 'ページビューの推移とトレンドを可視化します。', color: 'text-orange-500' },
  { icon: 'input', label: '流入分析', desc: 'チャネル別の流入元とトラフィック質を特定します。', color: 'text-blue-500' },
  { icon: 'target', label: 'CV分析', desc: 'コンバージョン経路と成果への寄与を分析します。', color: 'text-emerald-500' },
  { icon: 'search', label: '検索クエリ分析', desc: 'キーワードのニーズとパフォーマンスを網羅。', color: 'text-purple-500' },
  { icon: 'warning', label: '異常検知', desc: '数値の急激な変化や乖離を自動で検出します。', color: 'text-red-500' },
  { icon: 'web', label: 'LP分析', desc: 'ランディングページの離脱率と有効性を判定。', color: 'text-cyan-500' },
  { icon: 'devices', label: 'デバイス分析', desc: 'PC・SP・Tabの利用動向と差異を確認します。', color: 'text-indigo-500' },
  { icon: 'schedule', label: '時間帯分析', desc: '成果が出やすい曜日や時間帯の傾向を把握。', color: 'text-amber-500' },
  { icon: 'group', label: 'ユーザー属性', desc: '年齢・性別・地域などのデモグラフィック情報。', color: 'text-pink-500' },
  { icon: 'timer', label: 'エンゲージメント時間', desc: 'サイト滞在時間やユーザーの熱量を測定。', color: 'text-teal-500' },
  { icon: 'stacked_bar_chart', label: 'オークション圧分析', desc: '競合他社の入札動向と表示機会損失を分析。', color: 'text-rose-500' },
]

const STEPS = ['クエリタイプ選択', '期間選択', 'レポート生成']

export default function SetupWizard() {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState(new Set([0, 2]))

  const toggle = (i) => {
    const next = new Set(selected)
    next.has(i) ? next.delete(i) : next.add(i)
    setSelected(next)
  }

  return (
    <div className="p-10 max-w-[1200px] mx-auto space-y-10">
      {/* Header with tabs */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight">Setup Wizard</h2>
        <div className="flex bg-surface-container rounded-full p-1">
          {['EXCEL', 'BIGQUERY', '統合'].map((tab, i) => (
            <button
              key={tab}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
                i === 1 ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                i === step
                  ? 'bg-secondary text-on-secondary border-secondary'
                  : i < step
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-sm font-bold ${i === step ? 'text-[#1A1A2E]' : 'text-on-surface-variant'}`}>
              {s}
            </span>
            {i < STEPS.length - 1 && <div className="w-32 h-0.5 bg-outline-variant/30 mx-4" />}
          </div>
        ))}
      </div>

      {/* Query Type Selection */}
      <div>
        <div className="flex justify-between items-end mb-6">
          <div>
            <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text">クエリタイプを選択</h3>
            <p className="text-on-surface-variant mt-1 text-sm">分析したいデータ項目を選択してください（複数選択可能）</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="px-4 py-2 border border-outline-variant/50 rounded-xl text-sm font-bold hover:bg-surface-container transition-all">
              全解除
            </button>
            <button onClick={() => setSelected(new Set(QUERY_TYPES.map((_, i) => i)))} className="px-4 py-2 border border-outline-variant/50 rounded-xl text-sm font-bold hover:bg-surface-container transition-all">
              全選択
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {QUERY_TYPES.map((qt, i) => (
            <button
              key={qt.label}
              onClick={() => toggle(i)}
              className={`p-5 rounded-2xl text-left transition-all border-2 ${
                selected.has(i)
                  ? 'border-secondary bg-secondary/5 shadow-lg shadow-secondary/10'
                  : 'border-transparent bg-surface-container-lowest shadow-[0_24px_48px_-12px_rgba(26,26,46,0.04)] hover:shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className={`material-symbols-outlined text-2xl ${qt.color}`}>{qt.icon}</span>
                  <span className="font-bold text-[#1A1A2E] japanese-text">{qt.label}</span>
                </div>
                {selected.has(i) && (
                  <span className="material-symbols-outlined text-secondary">check_circle</span>
                )}
              </div>
              <p className="text-xs text-on-surface-variant mt-2 leading-relaxed japanese-text">{qt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-center gap-4 pt-4">
        <button className="px-10 py-3 border border-outline-variant/50 rounded-xl font-bold text-sm hover:bg-surface-container transition-all">
          戻る
        </button>
        <button className="px-10 py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-secondary/20">
          次へ
          <span className="material-symbols-outlined text-sm">chevron_right</span>
        </button>
      </div>
    </div>
  )
}
