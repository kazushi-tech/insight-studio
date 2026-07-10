import { useState } from 'react'
import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'
import { demoPreviewUrl, isExternalSalesUrl, salesContactUrl } from './salesContact'

function PlanLink({ to, className, children }) {
  if (isExternalSalesUrl(to)) {
    return <a href={to} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
  }
  return <Link to={to} className={className}>{children}</Link>
}

const plans = [
  {
    name: '画面サンプル',
    price: '無料',
    priceCaption: '申込み不要',
    description: 'レポートの見え方を先に確認したい方に',
    features: [
      'ダッシュボードと主要導線の確認',
      '基本レポート・グラフの表示確認',
      'AIキーなしの根拠整理を確認',
      'GA4・BigQueryの接続条件を確認',
    ],
    buttonLabel: '画面サンプルを見る',
    to: demoPreviewUrl,
    buttonClass: 'bg-primary text-white hover:-translate-y-0.5 shadow-lg shadow-primary/20',
    featured: false,
  },
  {
    name: 'セルフ運用',
    price: '先行導入',
    priceCaption: '条件確認後に書面でご案内',
    description: '自社で接続・分析を進めたい方に',
    features: [
      'GA4・BigQueryの実データ分析',
      '基本レポート・グラフ・根拠整理',
      '自分のGeminiキーで高度な分析を追加',
      '競合・LP・クリエイティブ分析',
      '機能別のGemini利用額を確認',
    ],
    buttonLabel: '導入条件を確認する',
    to: salesContactUrl,
    buttonClass: 'bg-tertiary-container text-on-tertiary-container hover:-translate-y-0.5 shadow-lg',
    featured: true,
  },
  {
    name: '導入・運用支援',
    price: '個別見積もり',
    priceCaption: '接続・支援範囲に応じてご案内',
    description: '接続や定例分析も一緒に進めたい方に',
    features: [
      '利用範囲とデータ定義の整理',
      'GA4・BigQuery接続の初期確認',
      'レポート構成と見る指標の調整',
      '運用に合わせた分析手順の整備',
      '外部ツール連携は要件確認後に設計',
    ],
    buttonLabel: '導入相談の準備をする',
    to: salesContactUrl,
    buttonClass: 'bg-white text-primary border border-primary/20 hover:bg-surface-container-low hover:-translate-y-0.5',
    featured: false,
  },
]

const buyingChecks = [
  { icon: 'language', label: '対象サイト数' },
  { icon: 'database', label: 'GA4・BigQueryの接続状況' },
  { icon: 'manage_accounts', label: '利用する担当者と権限' },
  { icon: 'support_agent', label: '初期設定・定例分析の支援範囲' },
]

const pricingSteps = [
  { title: '画面を確認', body: '申込み前に、レポートと分析メニューの見え方を確認します。' },
  { title: '接続条件を確認', body: '対象サイトとGoogle側の取得・権限状態を整理します。' },
  { title: '書面でご案内', body: 'サイト数、支援範囲、AI利用条件を明記してご案内します。' },
  { title: '初回レポート確認', body: '接続後の結果を一緒に確認し、継続して見る項目を決めます。' },
]

const faqs = [
  {
    q: 'AIのAPIキーは必ず必要ですか？',
    a: 'いいえ。基本レポート、グラフ、根拠整理はAIキーなしで利用できます。競合・LP・クリエイティブの詳細分析を使う場合は、GeminiまたはClaudeのキーが必要です。',
  },
  {
    q: 'Webサイトのデータを表示するには何が必要ですか？',
    a: 'GA4からBigQueryへのエクスポートと、対象プロジェクト・データセットへ接続できるGoogle側の設定が必要です。導入前に取得状況を確認します。',
  },
  {
    q: '料金はどのように決まりますか？',
    a: '現在は先行導入期間のため、接続するサイト数、分析範囲、初期設定支援、運用支援の有無を確認して提示します。AI APIの利用料は、原則として利用者自身のGoogleまたはAnthropicアカウントで発生します。',
  },
  {
    q: 'APIキーはどこに保存されますか？',
    a: '入力したAIキーは、利用中のタブを閉じるまでだけ保持されます。永続保存はしません。共有端末では利用後に画面から削除してください。法人導入時の保管方式や権限要件は、契約前に確認します。',
  },
  {
    q: '「とどくくん」と連携できますか？',
    a: '現時点では未連携です。将来の地域広告施策へつなぐ候補として、分析結果から対象地域・LP・訴求を受け渡す設計を検討しています。',
  },
]

export default function LpPricing() {
  const [openFaq, setOpenFaq] = useState(null)
  const toggleFaq = (i) => setOpenFaq(openFaq === i ? null : i)

  return (
    <>
      {/* ── Hero ── */}
      <LpSection animate={false} className="pt-32 pb-16 px-6 text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-tertiary/6 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />

        <div className="max-w-4xl mx-auto relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary-fixed/20 border border-primary/15 rounded-full px-5 py-2 mb-8">
            <span className="material-symbols-outlined text-primary text-base">payments</span>
            <span className="text-sm font-bold tracking-widest text-primary font-label">先行導入プラン</span>
          </div>

          <h1 className="font-headline text-4xl md:text-6xl font-extrabold text-on-surface leading-tight mb-6">
            使い方に合わせて、
            <br />
            導入範囲を選べます。
          </h1>

          <p className="font-body text-lg md:text-xl text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
            現在は先行導入として、接続条件と運用範囲を確認してご案内します。
            <br className="hidden md:block" />
            料金・席数・サポート範囲は、導入条件を確認した上で書面にてご案内します。
          </p>
        </div>
      </LpSection>

      {/* ── Pricing Cards ── */}
      <LpSection id="requirements" className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 rounded-3xl bg-surface-container-low p-6 md:p-8">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="text-sm font-bold text-primary">お見積り前に確認すること</p>
                <h2 className="mt-2 text-2xl font-extrabold text-on-surface md:text-3xl">必要なのは、次の4項目だけです。</h2>
                <p className="mt-3 text-sm leading-7 text-on-surface-variant">AIモデルや細かい指標は、相談時点で決め切る必要はありません。</p>
              </div>
              <a href={salesContactUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 font-bold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                導入条件を相談する
                <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>
              </a>
            </div>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {buyingChecks.map((item) => (
                <li key={item.label} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-4 text-sm font-bold text-on-surface ring-1 ring-outline-variant/35">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={`flex flex-col rounded-3xl p-8 transition-shadow hover:shadow-xl md:p-10 ${
                  plan.featured
                    ? 'bg-[#003d2a] text-white relative shadow-2xl md:-translate-y-4'
                    : 'bg-white border border-outline-variant/60 shadow-sm'
                }`}
              >
                {/* Badge for featured plan */}
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-tertiary-fixed-dim text-on-tertiary-fixed rounded-full px-5 py-2 text-sm font-extrabold shadow-lg">
                    <span className="material-symbols-outlined text-base">star</span>
                    おすすめ
                  </div>
                )}

                {/* Plan name */}
                <h3
                  className={`font-headline text-lg font-bold mb-2 ${
                    plan.featured ? 'text-primary-fixed' : 'text-on-surface-variant'
                  }`}
                >
                  {plan.name}
                </h3>

                {/* Price */}
                <div className="mb-2">
                  <span
                    className={`text-3xl md:text-4xl font-extrabold font-headline text-pretty ${
                      plan.featured ? 'text-tertiary-fixed' : 'text-on-surface'
                    }`}
                  >
                    {plan.price}
                  </span>
                  <p className={`mt-2 text-xs font-bold ${plan.featured ? 'text-primary-fixed/70' : 'text-on-surface-variant'}`}>{plan.priceCaption}</p>
                </div>

                {/* Description */}
                <p
                  className={`font-body text-sm mb-8 ${
                    plan.featured ? 'text-primary-fixed/70' : 'text-on-surface-variant'
                  }`}
                >
                  {plan.description}
                </p>

                {/* Features */}
                <ul className="space-y-4 mb-10 flex-grow">
                  {plan.features.map((feat, j) => (
                    <li key={j} className="flex items-start gap-3">
                      <span
                        className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${
                          plan.featured ? 'text-tertiary-fixed-dim' : 'text-primary'
                        }`}
                      >
                        check_circle
                      </span>
                      <span
                        className={`font-body text-sm ${
                          plan.featured ? 'text-primary-fixed/90' : 'text-on-surface'
                        }`}
                      >
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Button */}
                <PlanLink
                  to={plan.to}
                  className={`block min-h-11 rounded-2xl px-8 py-4 text-center text-base font-extrabold transition-transform focus-visible:outline-2 focus-visible:outline-offset-4 ${plan.buttonClass}`}
                >
                  {plan.buttonLabel}
                </PlanLink>
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      <LpSection className="bg-white px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-3 text-sm font-bold tracking-widest text-primary font-label">導入の進め方</p>
            <h2 className="text-pretty text-3xl font-extrabold text-on-surface md:text-4xl">契約を急がず、条件を順番に確認します。</h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-4">
            {pricingSteps.map((step, index) => (
              <li key={step.title} className="rounded-3xl border border-outline-variant/50 bg-surface-container-lowest p-6">
                <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-black text-on-primary">{index + 1}</span>
                <h3 className="mt-5 font-bold text-on-surface">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-on-surface-variant">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </LpSection>

      {/* ── FAQ ── */}
      <LpSection className="py-24 px-6 bg-surface-container-low">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">導入前の確認</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-on-surface leading-tight">
              よくあるご質問
            </h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-outline-variant/60 overflow-hidden transition-shadow hover:shadow-md"
              >
                <button
                  onClick={() => toggleFaq(i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`pricing-faq-${i}`}
                  className="w-full flex items-center justify-between gap-4 p-6 text-left cursor-pointer"
                >
                  <span className="font-headline text-base md:text-lg font-bold text-on-surface">
                    {faq.q}
                  </span>
                  <span
                    className={`material-symbols-outlined text-2xl text-on-surface-variant flex-shrink-0 transition-transform duration-300 ${
                      openFaq === i ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </button>
                <div
                  id={`pricing-faq-${i}`}
                  className={`overflow-hidden transition-[max-height,opacity] duration-300 ${
                    openFaq === i ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="font-body text-sm md:text-base text-on-surface-variant leading-relaxed px-6 pb-6">
                    {faq.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ── CTA ── */}
      <LpCta
        variant="dark"
        heading={'まずはデモで、\n画面と接続条件を確認。'}
        body="一般販売前のため、実データ接続・運用支援・AI利用範囲を確認して導入内容を決めます。"
        primaryLabel="画面サンプルを見る"
        primaryTo={demoPreviewUrl}
        secondaryLabel="導入条件を相談する"
        secondaryTo={salesContactUrl}
      />
    </>
  )
}
