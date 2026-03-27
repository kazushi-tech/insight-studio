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
        <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text mb-3">この機能は現在利用できません</h3>
        <p className="text-on-surface-variant max-w-lg japanese-text leading-relaxed">
          クリエイティブレビュー機能は、バナー画像やLP素材の <strong>アセットアップロード（asset_id）</strong> を前提とする
          Market Lens の新しい review API 契約に移行済みです。
        </p>
        <p className="text-on-surface-variant max-w-lg japanese-text leading-relaxed mt-2">
          <strong>Gemini API キーだけでは再開できません。</strong>
          アセットのアップロード・選択ワークフローの実装が完了次第、ご利用いただけるようになります。
        </p>
      </div>

      {/* FAQ Section */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8">
        <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">help</span>
          よくある質問
        </h3>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-bold text-on-surface japanese-text mb-1">Q. Gemini API キーを設定すれば使えるようになりますか？</p>
            <p className="text-sm text-on-surface-variant japanese-text leading-relaxed">
              いいえ。現在の review API は <code className="px-1.5 py-0.5 rounded bg-surface-container text-xs">asset_id</code> を
              リクエストに含める必要があります。asset_id はアセットアップロード後に取得できるもので、
              API キーだけでは生成できません。
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface japanese-text mb-1">Q. LP比較分析・競合発見とは何が違いますか？</p>
            <p className="text-sm text-on-surface-variant japanese-text leading-relaxed">
              LP比較分析と競合発見は <strong>URL を入力するだけ</strong> で利用できます。
              一方、クリエイティブレビューは <strong>画像やバナー素材のアップロード</strong> が前提の機能です。
              扱うデータの種類が異なるため、必要なワークフローも異なります。
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface japanese-text mb-1">Q. いつ頃使えるようになりますか？</p>
            <p className="text-sm text-on-surface-variant japanese-text leading-relaxed">
              アセットアップロード機能の実装スケジュールは未定です。
              進捗があり次第、このページでお知らせします。
            </p>
          </div>
        </div>
      </div>

      {/* Alternative Actions */}
      <div className="flex justify-center gap-4">
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
  )
}
