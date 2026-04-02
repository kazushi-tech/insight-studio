import { useState } from 'react'
import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

const plans = [
  {
    name: 'Free',
    price: '¥0',
    period: '/月',
    description: 'まずは気軽に試したい方に',
    features: [
      '競合LP比較（月5回まで）',
      'クリエイティブ診断（月3回まで）',
      '基本ダッシュボード',
      'メールサポート',
    ],
    buttonLabel: '無料で始める',
    buttonClass: 'bg-primary text-white hover:-translate-y-0.5 shadow-lg shadow-primary/20',
    featured: false,
  },
  {
    name: 'Pro',
    price: '¥29,800',
    period: '/月',
    description: 'チームで本格的に活用したい方に',
    features: [
      '競合LP比較（無制限）',
      'クリエイティブ診断（無制限）',
      '広告パフォーマンス考察',
      'AI Explorer',
      '優先サポート',
    ],
    buttonLabel: 'Proプランを始める',
    buttonClass: 'bg-tertiary-container text-on-tertiary-container hover:-translate-y-0.5 shadow-lg',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'お問い合わせ',
    period: '',
    description: '大規模チーム・カスタム要件に',
    features: [
      'Proプランの全機能',
      'カスタムAPI連携',
      '専用アカウントマネージャー',
      'SLA保証',
      'オンボーディング支援',
    ],
    buttonLabel: 'お問い合わせ',
    buttonClass: 'bg-white text-primary border border-primary/20 hover:bg-surface-container-low hover:-translate-y-0.5',
    featured: false,
  },
]

const faqs = [
  {
    q: '無料プランにクレジットカードの登録は必要ですか？',
    a: 'いいえ、無料プランの利用にクレジットカードの登録は必要ありません。メールアドレスだけですぐにご利用いただけます。',
  },
  {
    q: 'プランの変更やキャンセルはいつでもできますか？',
    a: 'はい、いつでも可能です。アップグレードは即時反映、ダウングレードは次の請求サイクルから適用されます。キャンセルも管理画面からワンクリックで行えます。',
  },
  {
    q: '14日間の無料トライアルではどの機能が使えますか？',
    a: 'Proプランの全機能をお試しいただけます。競合LP比較、クリエイティブ診断、広告パフォーマンス考察、AI Explorerなど、すべての機能を制限なくご利用いただけます。',
  },
  {
    q: 'データのセキュリティはどのように担保されていますか？',
    a: 'すべてのデータは暗号化して保存され、通信もTLS 1.3で暗号化されています。SOC 2 Type II認証を取得しており、エンタープライズレベルのセキュリティを提供しています。',
  },
  {
    q: 'チームメンバーの追加に費用はかかりますか？',
    a: 'Proプランには5名分のシートが含まれています。追加メンバーは1名あたり月額¥4,980で追加可能です。Enterpriseプランではカスタムのシート数を設定できます。',
  },
]

export default function LpPricing() {
  const [openFaq, setOpenFaq] = useState(null)
  const toggleFaq = (i) => setOpenFaq(openFaq === i ? null : i)

  return (
    <>
      {/* ── Hero ── */}
      <LpSection className="pt-32 pb-16 px-6 text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-tertiary/6 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />

        <div className="max-w-4xl mx-auto relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary-fixed/20 border border-primary/15 rounded-full px-5 py-2 mb-8">
            <span className="material-symbols-outlined text-primary text-base">payments</span>
            <span className="text-sm font-bold tracking-widest text-primary font-label">PRICING PLANS</span>
          </div>

          <h1 className="font-headline text-4xl md:text-6xl font-extrabold text-on-surface leading-tight mb-6">
            あなたのチームに
            <br />
            最適なプランを。
          </h1>

          <p className="font-body text-lg md:text-xl text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
            すべてのプランに14日間の無料トライアル付き。
            <br className="hidden md:block" />
            クレジットカード登録不要ですぐに始められます。
          </p>
        </div>
      </LpSection>

      {/* ── Pricing Cards ── */}
      <LpSection className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan, i) => (
              <div
                key={i}
                className={`rounded-3xl p-8 md:p-10 flex flex-col transition-all hover:shadow-xl ${
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
                    className={`text-4xl md:text-5xl font-extrabold font-headline ${
                      plan.featured ? 'text-tertiary-fixed' : 'text-on-surface'
                    }`}
                  >
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span
                      className={`text-lg ml-1 ${
                        plan.featured ? 'text-primary-fixed/60' : 'text-on-surface-variant'
                      }`}
                    >
                      {plan.period}
                    </span>
                  )}
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
                <Link
                  to="/"
                  className={`block text-center px-8 py-4 rounded-2xl font-extrabold text-base transition-all ${plan.buttonClass}`}
                >
                  {plan.buttonLabel}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ── FAQ ── */}
      <LpSection className="py-24 px-6 bg-surface-container-low">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">FAQ</p>
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
                  className={`overflow-hidden transition-all duration-300 ${
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
        heading={'まずは14日間、無料で\n全機能をお試しください。'}
        body="Proプランの全機能を14日間無料でお試しいただけます。クレジットカード登録不要。いつでもキャンセル可能です。"
        primaryLabel="無料トライアルを始める"
        primaryTo="/"
        secondaryLabel="デモを予約する"
        secondaryTo="#"
      />
    </>
  )
}
