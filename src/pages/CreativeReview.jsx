export default function CreativeReview() {
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
        </div>
      </div>

      {/* Unavailable Notice */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-12 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-amber-50 rounded-2xl flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-4xl text-amber-600">construction</span>
        </div>
        <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text mb-3">この機能は一時停止中です</h3>
        <p className="text-on-surface-variant max-w-lg japanese-text leading-relaxed">
          クリエイティブレビュー機能は、Market Lens backend の review API が
          アセットアップロードワークフロー（asset_id）を前提とする契約に移行したため、
          現在のフロントエンドからは利用できません。
        </p>
        <p className="text-on-surface-variant max-w-lg japanese-text leading-relaxed mt-2">
          対応が完了次第、再度ご利用いただけます。
        </p>
        <div className="mt-8 flex gap-4">
          <a
            href="/compare"
            className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm"
          >
            <span className="material-symbols-outlined text-lg">compare_arrows</span>
            LP比較分析を使う
          </a>
          <a
            href="/discovery"
            className="px-6 py-3 bg-surface-container text-on-surface rounded-xl font-bold flex items-center gap-2 hover:bg-surface-container-high transition-all text-sm"
          >
            <span className="material-symbols-outlined text-lg">travel_explore</span>
            競合発見を使う
          </a>
        </div>
      </div>
    </div>
  )
}
