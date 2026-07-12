import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

const ANALYSIS_TOOLS = [
  {
    to: '/insights/ai',
    icon: 'auto_awesome',
    eyebrow: 'サイトの数字を深掘り',
    title: '数字についてAIに相談する（AI考察）',
    description: 'レポートとグラフの根拠をまとめ、次に確認することを質問できます。サイト分析の準備後に使えます。',
    keyRequired: false,
    action: 'AI考察を開く',
  },
  {
    to: '/compare',
    icon: 'balance',
    eyebrow: '2つのページを見比べる',
    title: '自社と競合のページを比べる（競合LP比較）',
    description: '2つのURLを入力して、訴求・構成・改善の優先候補を同じ基準で比べます。',
    keyRequired: true,
    adminOnly: true,
    action: 'ページ比較を開く',
  },
  {
    to: '/discovery',
    icon: 'travel_explore',
    eyebrow: '比較する相手を探す',
    title: '似ている競合サイトを探す（競合発見）',
    description: '自社サイトのURLから、比較候補と見るべき観点を整理します。',
    keyRequired: true,
    adminOnly: true,
    action: '競合探しを開く',
  },
  {
    to: '/creative-review',
    icon: 'image_search',
    eyebrow: '画像の伝わり方を確認',
    title: 'バナー画像の改善点を見る（バナーレビュー）',
    description: '広告画像を見ながら、読みやすさ・情報の優先順位・改善候補を整理します。',
    keyRequired: true,
    adminOnly: true,
    action: 'バナー確認を開く',
  },
]

function KeyStatus({ required, configured, siteAnalysisReady = true, available = true }) {
  if (!available) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">support_agent</span>
        導入担当者が利用
      </span>
    )
  }
  if (!required) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
        siteAnalysisReady
          ? 'bg-primary-container/60 text-on-primary-container'
          : 'bg-amber-100 text-amber-900 dark:bg-warning-container dark:text-on-warning-container'
      }`}>
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{siteAnalysisReady ? 'check_circle' : 'tune'}</span>
        {siteAnalysisReady ? '基本レポートの根拠で利用可' : 'サイト分析の準備が必要'}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
      configured
        ? 'bg-emerald-100 text-emerald-800 dark:bg-success-container dark:text-on-success-container'
        : 'bg-amber-100 text-amber-900 dark:bg-warning-container dark:text-on-warning-container'
    }`}>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {configured ? 'check_circle' : 'key'}
      </span>
      {configured ? 'APIキー設定済み' : '利用にはAPIキーが必要'}
    </span>
  )
}

export default function AnalysisHub() {
  const { hasAnalysisKey, isAdsAuthenticated, user } = useAuth()
  const { isSetupComplete, isCaseAuthenticated, setupState, currentCase } = useAdsSetup()
  const canUseAdvancedAnalysis = ['admin', 'operator'].includes(user?.role) || user?.platform_role === 'platform_admin'
  const datasetMatches = !setupState?.datasetId || !currentCase?.dataset_id || setupState.datasetId === currentCase.dataset_id
  const siteAnalysisReady = Boolean(isAdsAuthenticated && isSetupComplete && isCaseAuthenticated && datasetMatches)

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <header className="grid gap-5 rounded-3xl bg-primary px-5 py-6 text-on-primary shadow-sm sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-3xl space-y-3">
          <p className="text-xs font-black tracking-[0.12em] text-on-primary/70">分析メニュー</p>
          <h1 className="text-2xl font-black leading-tight japanese-text sm:text-3xl">
            やりたいことから選べます
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-on-primary/80 sm:text-base">
            難しい機能名を覚える必要はありません。確認したい内容を選ぶと、入力画面へ進みます。
          </p>
        </div>

        <div className="rounded-2xl bg-white/10 p-4 lg:w-[310px]">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-xl" aria-hidden="true">
              {!canUseAdvancedAnalysis ? 'support_agent' : hasAnalysisKey ? 'verified' : 'tune'}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-black">
                {!canUseAdvancedAnalysis
                  ? '追加分析は導入担当者が行います'
                  : hasAnalysisKey
                    ? '追加分析の準備ができています'
                    : '追加分析を有効にできます'}
              </p>
              <p className="text-xs leading-5 text-on-primary/75">
                {!canUseAdvancedAnalysis
                  ? '先行導入中は、競合・画像分析を担当者側で安全に実行します。基本レポートとグラフはこの画面から利用できます。'
                  : hasAnalysisKey && siteAnalysisReady
                  ? 'サイト分析と、競合・バナーの追加分析を始められます。'
                  : hasAnalysisKey
                    ? '追加分析を利用できます。自社サイトのレポートは、先にサイト分析を準備してください。'
                    : siteAnalysisReady
                      ? '基本レポートとグラフは利用できます。追加分析は設定完了後に始められます。'
                      : '自社サイトのレポートは分析の準備後、追加分析は運用設定の完了後に利用できます。'}
              </p>
              {canUseAdvancedAnalysis ? (
                <Link
                  to="/settings"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black text-primary transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span className="material-symbols-outlined text-[17px]" aria-hidden="true">settings</span>
                  {hasAnalysisKey ? '追加分析の設定を確認' : '追加分析を有効にする'}
                </Link>
              ) : (
                <Link to={siteAnalysisReady ? '/ads/report' : '/ads/wizard'} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black text-primary">
                  {siteAnalysisReady ? '自社レポートを見る' : 'サイト分析を準備'}
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <section aria-labelledby="analysis-tools-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="analysis-tools-title" className="text-xl font-black text-on-surface japanese-text sm:text-2xl">
            できること
          </h2>
          <p className="text-sm leading-6 text-on-surface-variant">
            {canUseAdvancedAnalysis
              ? '利用できる分析と必要な準備をカード内で確認できます。'
              : '自社サイトのレポートを根拠に、気になる数字を質問できます。'}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {ANALYSIS_TOOLS.filter((tool) => !tool.adminOnly || canUseAdvancedAnalysis).map((tool) => {
            const isSiteAi = tool.to === '/insights/ai'
            const toolAvailable = !tool.adminOnly || canUseAdvancedAnalysis
            const destination = isSiteAi && !siteAnalysisReady ? '/ads/wizard' : tool.to
            const actionLabel = isSiteAi && !siteAnalysisReady ? 'サイト分析を準備' : tool.action
            return (
            <article
              key={tool.to}
              className="group flex min-h-[270px] flex-col rounded-3xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-outline-variant/15 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-container text-on-primary-container">
                  <span className="material-symbols-outlined text-[25px]" aria-hidden="true">{tool.icon}</span>
                </span>
                <KeyStatus required={tool.keyRequired} configured={hasAnalysisKey} siteAnalysisReady={siteAnalysisReady} available={toolAvailable} />
              </div>

              <div className="mt-5 flex-1 space-y-2">
                <p className="text-xs font-black text-secondary">{tool.eyebrow}</p>
                <h3 className="text-lg font-black leading-7 text-on-surface japanese-text sm:text-xl">
                  {tool.title}
                </h3>
                <p className="text-sm leading-6 text-on-surface-variant">{tool.description}</p>
                {!tool.keyRequired && !hasAnalysisKey && (
                  <p className="text-xs leading-5 text-on-surface-variant">
                    追加設定なしでも、表示中の根拠を整理して質問できます。
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {toolAvailable ? (
                  <Link
                    to={destination}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-on-primary transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px motion-reduce:transition-none"
                  >
                    {actionLabel}
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center rounded-xl bg-surface-container px-4 py-2.5 text-sm font-bold text-on-surface-variant">
                    先行導入では担当者が実行
                  </span>
                )}
                {toolAvailable && tool.keyRequired && !hasAnalysisKey && (
                  <Link
                    to="/settings"
                    className="inline-flex min-h-11 items-center rounded-xl px-2 py-2.5 text-sm font-bold text-secondary underline decoration-secondary/35 underline-offset-4 hover:decoration-secondary"
                  >
                    追加分析を有効にする
                  </Link>
                )}
              </div>
            </article>
            )
          })}
        </div>
      </section>

      <aside className="flex flex-col gap-3 rounded-2xl bg-surface-container p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5" aria-label="迷ったときの案内">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined mt-0.5 text-xl text-secondary" aria-hidden="true">lightbulb</span>
          <div>
            <p className="text-sm font-black text-on-surface">まず自社サイトの状況を見たい場合</p>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">レポートで要点を確認してから、グラフで根拠を見る順番がおすすめです。</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to={siteAnalysisReady ? '/ads/report' : '/ads/wizard'} className="inline-flex min-h-11 items-center rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary shadow-sm">
            {siteAnalysisReady ? 'レポートを見る' : '分析を準備'}
          </Link>
          {siteAnalysisReady && (
            <Link to="/ads/graphs" className="inline-flex min-h-11 items-center rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary shadow-sm">
              グラフを見る
            </Link>
          )}
        </div>
      </aside>
    </div>
  )
}
