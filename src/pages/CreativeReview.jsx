export default function CreativeReview() {
  const scores = [
    { label: 'レイアウト構造', score: '9/10', desc: 'ファーストビューから商品ベネフィットへの遷移が非常にスムーズ。Zパターンを意識した視線誘導が確立されている。' },
    { label: '視覚的アイデンティティ', score: '8/10', desc: '高級感を演出する「引き算の美学」が徹底されている。配色比率が黄金比に近い。' },
    { label: 'コピーライティング戦略', score: '7/10', desc: 'ベネフィットの言語化は優れているが、クロージングコピーがやや弱い。' },
  ]

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-on-surface-variant mb-2">
            <span>競合LP分析</span>
            <span className="material-symbols-outlined text-sm">chevron_right</span>
            <span className="text-secondary font-bold">クリエイティブ・レビュー</span>
          </div>
          <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight">Creative Review & Scoring</h2>
          <p className="text-on-surface-variant mt-1">Project ID: LUX-2024-081</p>
        </div>
        <div className="flex gap-3">
          <button className="px-5 py-2.5 bg-white border border-outline-variant/50 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-surface-container transition-all">
            <span className="material-symbols-outlined text-lg">download</span>
            PDF書き出し
          </button>
          <button className="px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20">
            <span className="material-symbols-outlined text-lg">bolt</span>
            AI再分析を実行
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* LP Preview */}
        <div className="col-span-6 bg-surface-container rounded-2xl min-h-[500px] flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 left-4 flex gap-2">
            <span className="px-3 py-1 bg-surface-container-lowest rounded-lg text-xs font-bold">ANALYSIS TARGET</span>
            <span className="px-3 py-1 bg-secondary text-on-secondary rounded-lg text-xs font-bold">LUXURY COSMETICS</span>
          </div>
          <span className="material-symbols-outlined text-8xl text-outline-variant/40">image</span>
          <p className="text-on-surface-variant text-sm mt-4 japanese-text">LPプレビュー画像</p>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">link</span>
            <span>URL Source</span>
          </div>
        </div>

        {/* Score Panel */}
        <div className="col-span-6 space-y-6">
          {/* Radar placeholder */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold">Performance Radar</h3>
                <p className="text-sm text-on-surface-variant">4-axis comparative scoring</p>
              </div>
              <div className="w-16 h-16 bg-primary text-on-primary rounded-xl flex flex-col items-center justify-center">
                <span className="text-xs">Total Score</span>
                <span className="text-2xl font-black">84</span>
              </div>
            </div>
            {/* Radar chart placeholder */}
            <div className="h-40 flex items-center justify-center mt-4">
              <div className="w-40 h-40 border-2 border-outline-variant/30 rotate-45 rounded-lg flex items-center justify-center">
                <div className="w-24 h-24 bg-secondary/10 rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="p-3 bg-surface-container rounded-xl">
                <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold">Conversion Rate Est.</p>
                <p className="text-2xl font-black tabular-nums mt-1">3.24%</p>
              </div>
              <div className="p-3 bg-surface-container rounded-xl">
                <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold">Avg. Time on Page</p>
                <p className="text-2xl font-black tabular-nums mt-1">02:45</p>
              </div>
            </div>
          </div>

          {/* Analysis Report */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-5">
            <h3 className="text-xl font-bold japanese-text">分析レポート</h3>
            {scores.map((s) => (
              <div key={s.label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="font-bold text-sm japanese-text">{s.label}</span>
                  </div>
                  <span className="text-sm font-bold text-on-surface-variant">Score: {s.score}</span>
                </div>
                <p className="text-sm text-on-surface-variant leading-relaxed japanese-text pl-5">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
