import { useState } from 'react'

const QUICK_PROMPTS = [
  { icon: 'warning', label: 'リスクを要約して', color: 'text-red-500' },
  { icon: 'lightbulb', label: 'ROI改善のアイデア', color: 'text-emerald-500' },
  { icon: 'compare_arrows', label: '先月と比較して', color: 'text-purple-500' },
]

const MOCK_MESSAGES = [
  {
    role: 'ai',
    content: {
      title: 'Insight AI 分析レポート',
      body: '最新の広告パフォーマンスデータを分析しました。以下の3点が重要な考察ポイントです。',
      cards: [
        { icon: 'trending_up', title: 'コンバージョン効率の向上', desc: 'クリエイティブBのCTRが前週比で18%向上。特定のターゲット層においてエンゲージメントが集中しています。' },
        { icon: 'attach_money', title: 'CPAの上昇傾向', desc: 'リターゲティング広告のCPAが目標値を5%上回っています。フリークエンシーの最適化が必要です。' },
      ],
    },
  },
  {
    role: 'user',
    content: 'ROIをさらに改善するための具体的なアクションプランを提案してください。',
    time: '10:42 AM',
  },
  {
    role: 'ai',
    content: {
      title: 'ROI改善に向けた戦略的ロードマップ',
      steps: [
        { num: '01', title: '入札戦略の動的調整', desc: '過去30日間のコンバージョン発生時間帯を分析した結果、19時〜23時の時間帯に入札比率を25%引き上げることで、同一予算内でのCV数を最大化できる見込みです。' },
      ],
    },
  },
]

export default function AiExplorer() {
  const [input, setInput] = useState('')

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Quick Prompts */}
      <div className="px-10 pt-8 pb-4">
        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-4">QUICK ANALYSIS</p>
        <div className="flex gap-4">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.label}
              className="flex items-center gap-3 px-6 py-3 bg-surface-container-lowest rounded-xl border border-outline-variant/30 hover:border-secondary/50 hover:shadow-lg transition-all text-sm font-bold"
            >
              <span className={`material-symbols-outlined ${p.color}`}>{p.icon}</span>
              <span className="japanese-text">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-10 py-6 space-y-6">
        {MOCK_MESSAGES.map((msg, i) =>
          msg.role === 'ai' ? (
            <div key={i} className="flex gap-4">
              <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-gold text-lg">smart_toy</span>
              </div>
              <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 max-w-3xl space-y-4">
                {msg.content.title && (
                  <h3 className="text-lg font-bold japanese-text">{msg.content.title}</h3>
                )}
                {msg.content.body && (
                  <p className="text-sm text-on-surface-variant leading-relaxed japanese-text">{msg.content.body}</p>
                )}
                {msg.content.cards && (
                  <div className="grid grid-cols-2 gap-4">
                    {msg.content.cards.map((card) => (
                      <div key={card.title} className="bg-surface-container rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-secondary text-lg">{card.icon}</span>
                          <span className="font-bold text-sm japanese-text">{card.title}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant leading-relaxed japanese-text">{card.desc}</p>
                      </div>
                    ))}
                  </div>
                )}
                {msg.content.steps && (
                  <div className="space-y-4">
                    {msg.content.steps.map((step) => (
                      <div key={step.num}>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-2xl font-black text-secondary tabular-nums">{step.num}</span>
                          <h4 className="font-bold japanese-text">{step.title}</h4>
                        </div>
                        <p className="text-sm text-on-surface-variant leading-relaxed japanese-text pl-10">{step.desc}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-on-surface-variant">AI 考察エンジン v2.4・ちょうど今</p>
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-end gap-4">
              <div className="bg-primary-container text-on-primary rounded-2xl px-6 py-4 max-w-2xl">
                <p className="text-sm leading-relaxed text-white japanese-text">{msg.content}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container shrink-0">
                田
              </div>
            </div>
          )
        )}
      </div>

      {/* Input */}
      <div className="px-10 pb-6 pt-2">
        <div className="flex items-center gap-3 bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] px-6 py-3">
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="AIにデータについて質問する..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="text-on-surface-variant hover:text-primary transition-colors">
            <span className="material-symbols-outlined">attach_file</span>
          </button>
          <button className="w-10 h-10 bg-secondary text-on-secondary rounded-full flex items-center justify-center hover:opacity-90 transition-all">
            <span className="material-symbols-outlined">send</span>
          </button>
        </div>
        <div className="flex items-center justify-center gap-6 mt-3 text-xs text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">lock</span>
            エンタープライズ品質の暗号化
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">verified_user</span>
            学習データとしての利用はされません
          </span>
        </div>
      </div>
    </div>
  )
}
