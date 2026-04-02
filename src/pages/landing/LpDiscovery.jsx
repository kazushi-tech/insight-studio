import { useState } from 'react'
import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'

/* ── Data ── */
const problems = [
  {
    icon: 'timer_off',
    title: '膨大な手作業による調査時間のロス',
    desc: '手動でのキーワード検索、競合サイトの巡回、レポート作成。広告運用の要である分析作業が、日々クリエイティブな時間を奪っています。',
    span: 'md:col-span-8',
  },
  {
    icon: 'visibility_off',
    title: '見落とされる潜在競合',
    desc: '既存の競合リストだけでは不十分。急成長中のスタートアップや、隣接カテゴリーからの新規参入を見逃していませんか？',
    span: 'md:col-span-4',
    bg: 'bg-emerald-50',
  },
  {
    icon: 'view_column',
    title: '断片化されたデータ',
    desc: '検索順位、バナークリエイティブ、LP。バラバラのツールで管理されるデータを統合するだけで一苦労です。',
    span: 'md:col-span-12',
  },
]

const steps = [
  { icon: 'language', num: 1, title: 'URL入力', desc: '自社サイトまたはターゲットURLを入力するだけ。' },
  { icon: 'psychology', num: 2, title: 'AI自動スキャン', desc: 'AIが関連キーワードと競合サイトを数秒で特定します。' },
  { icon: 'analytics', num: 3, title: 'マップ＆レポート', desc: '即座に実行可能な分析レポートを自動生成します。', accent: true },
]

const discoveries = [
  { initial: 'A', name: 'Alpha Digital', detail: '広告費シェア: 12% 急上昇中' },
  { initial: 'S', name: 'Skyline SaaS', detail: '新規LP確認: 2時間前' },
]

const testimonials = [
  {
    text: '「今まで見落としていた小規模な競合のLP戦略が浮き彫りになり、広告のCPAが30%改善しました。」',
    name: '佐藤 健太',
    role: '大手飲料メーカー マーケティング部長',
  },
  {
    text: '「レポート作成の時間がゼロになり、チームの士気が格段に上がりました。AIの分析精度には驚かされます。」',
    name: '田中 舞',
    role: '広告代理店 アカウントディレクター',
  },
  {
    text: '「スタートアップにとって情報の非対称性は死活問題。このツールは私たちの最強の武器になっています。」',
    name: '高橋 浩',
    role: 'SaaS企業 CEO',
  },
]

const faqs = [
  { q: 'どのようなデータが分析可能ですか？', a: '検索広告の出稿状況、主要キーワードの順位、クリエイティブの変化、LPの構造更新、市場におけるシェア推移など、公開されているウェブ情報をAIが包括的に分析します。' },
  { q: '分析の精度はどのくらいですか？', a: '独自の機械学習モデルにより、関連性の高い競合を98%以上の精度で特定します。また、人間が気づきにくい文脈上の競合もAIが見つけ出します。' },
  { q: '海外の競合も調査できますか？', a: 'はい、世界120カ国以上のウェブデータをサポートしており、グローバル展開しているブランドの調査も可能です。' },
  { q: '導入には時間がかかりますか？', a: '最短1分で完了します。アカウント作成後、URLを入力するだけで即座に初期レポートが生成されます。' },
  { q: 'レポートの出力形式は？', a: 'ダッシュボード上での閲覧に加え、PDF、CSV、Googleスライド形式でのエクスポートに対応しています。' },
]

const logos = ['GLOBAL_S', 'MARKET_MIND', 'DATA_CRAFT', 'ZENITH_LABS', 'CORE_FLOW']

/* ── Component ── */
export default function LpDiscovery() {
  return (
    <>
      {/* Ambient orbs */}
      <div className="lp-orb w-[500px] h-[500px] bg-emerald-400 top-0 left-0" />
      <div className="lp-orb w-[400px] h-[400px] bg-amber-400 bottom-0 right-0" />

      {/* ━━ 1. Hero ━━ */}
      <section className="relative min-h-screen flex items-center overflow-hidden lp-animate-gradient bg-gradient-to-br from-[#064e3b] via-[#10b981] to-[#D4A843] px-8">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
          <div className="space-y-8">
            <h1 className="text-5xl lg:text-7xl font-extrabold text-white leading-tight tracking-tighter">
              見逃している競合、
              <br />
              AIが1分で特定。
            </h1>
            <p className="text-white/90 text-xl font-medium max-w-xl">
              URLを入力するだけで、独自のアルゴリズムがあなたの市場をリアルタイムにスキャン。隠れたライバルの戦略を瞬時に可視化します。
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/"
                className="bg-white text-emerald-700 px-10 py-4 rounded-lg font-bold text-lg lp-animate-glow active:scale-95 transition-all"
              >
                無料で試してみる
              </Link>
              <Link
                to="#demo"
                className="border-2 border-white text-white px-10 py-4 rounded-lg font-bold text-lg hover:bg-white/10 active:scale-95 transition-all"
              >
                製品デモを見る
              </Link>
            </div>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <div className="w-full max-w-lg aspect-square bg-white/10 backdrop-blur-2xl rounded-full p-8 lp-animate-float border border-white/20">
              <img
                alt="Competitor Map visualization"
                className="w-full h-full object-contain mix-blend-screen opacity-90"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCH7Cv9-8Wijbts1d04yR8dZOiCjGYe3cMihjxzXQk6_M0Tw76PHMMBRcMc6zK_AdaJwUXN5jGBnpT93dLp0HFyww-rkkYuuFZeY3-Nhhs72EV7RkTMzwNvDdw7OY4nT0LJQLfmBvwug-JyyUP5y55ZZ5255nwVeaJfdgTYI30BTm15REDmWrM-DIpaEk07rffj550YIay0k1p-njGgfzlJzRDtup5DqsngpSRv8CkvKakpaaSmqouyL2EPjHXdMpROMAqpBIrQB2w"
              />
            </div>
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-amber-300 rounded-full blur-3xl opacity-50" />
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/70 lp-animate-bounce cursor-pointer">
          <span className="material-symbols-outlined text-4xl">keyboard_double_arrow_down</span>
        </div>
      </section>

      {/* ━━ 2. Problem ━━ */}
      <LpSection className="py-24 bg-white px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-3xl lg:text-5xl font-extrabold tracking-tighter mb-6">
              広告運用チームが直面する競合分析の壁
            </h2>
            <div className="h-1.5 w-24 bg-primary mx-auto rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {problems.map((p, i) => (
              <div
                key={p.icon}
                className={`${p.span} ${p.bg || 'bg-surface-container-low'} p-10 rounded-xl hover:-translate-y-2 hover:shadow-[0_20px_60px_-12px_rgba(16,185,129,0.15)] transition-all duration-300`}
              >
                <span className="material-symbols-outlined text-primary text-5xl mb-4">{p.icon}</span>
                <h3 className="text-2xl font-bold mb-4">{p.title}</h3>
                <p className="text-on-surface-variant leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ━━ 3. 3-Step Demo ━━ */}
      <LpSection id="demo" stagger className="py-24 bg-surface-container-low px-8 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-12">
            {steps.map((s, i) => (
              <div key={s.num} className="contents">
                <div className="w-full md:w-1/3">
                  <div
                    className={`${s.accent ? 'bg-primary text-white' : 'bg-white'} p-8 rounded-2xl shadow-xl shadow-primary/5 relative hover:-translate-y-2 transition-all duration-300`}
                  >
                    <div className={`absolute -top-4 -left-4 w-12 h-12 ${s.accent ? 'bg-tertiary-container' : 'bg-primary'} text-white rounded-full flex items-center justify-center font-bold text-xl`}>
                      {s.num}
                    </div>
                    <span className={`material-symbols-outlined ${s.accent ? 'text-white' : 'text-primary'} text-4xl mb-4`}>
                      {s.icon}
                    </span>
                    <h4 className="text-xl font-bold mb-2">{s.title}</h4>
                    <p className={`${s.accent ? 'text-white/80' : 'text-on-surface-variant'} text-sm`}>{s.desc}</p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden md:block text-primary">
                    <span className="material-symbols-outlined text-4xl">trending_flat</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ━━ 4. Bento Grid — Discovery Module ━━ */}
      <LpSection id="features" className="py-24 bg-white px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-primary mb-2">Discovery Module</h2>
            <h3 className="text-4xl font-extrabold tracking-tighter">直感的なインターフェースで、洞察を加速。</h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-2 gap-4 h-auto lg:h-[800px]">
            {/* Large Map */}
            <div className="lg:col-span-8 lg:row-span-2 bg-surface-container-low rounded-3xl p-8 relative overflow-hidden hover:scale-[1.01] transition-transform duration-500 shadow-sm">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h4 className="text-2xl font-bold">競合マーケットマップ</h4>
                  <p className="text-on-surface-variant">競合他社のポジショニングを多角的視点で可視化</p>
                </div>
                <span className="bg-primary/10 text-primary px-4 py-1 rounded-full text-xs font-bold">Real-time</span>
              </div>
              <img
                alt="Network Map"
                className="w-full h-full object-cover rounded-xl opacity-80 mix-blend-multiply"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDOHgiK5oqU_fmJ20CpiPo3l4lfU7fvmupkRjuPWKnNqg-7yskVRqr4U5JV4WBD4OpbCTJ60x29KSQGdOJIczSObj8Kz8dysWbLVA4DY6u0fZq9d3UVNGf8VsAJh-QSlSbO8j-DzyTOUOKYRQzYrXeAyJMFpMMyqEHCOVLrL90Rmz-c6tZUcOEqIA98-zmqsKCJ7cwkG_-6HaybwJsBmgPV39RvX8BdgN3GmuniAidSbmmxyrwycfiNITfNW8CLy-10Px09qwBcxO8"
              />
            </div>

            {/* Discoveries */}
            <div className="lg:col-span-4 bg-emerald-900 text-white rounded-3xl p-8 hover:scale-[1.02] transition-transform duration-500 shadow-lg">
              <h4 className="text-xl font-bold mb-4">新規発見された競合</h4>
              <div className="space-y-4">
                {discoveries.map((d) => (
                  <div key={d.initial} className="flex items-center gap-4 bg-white/10 p-3 rounded-lg border border-white/10">
                    <div className="w-10 h-10 bg-primary-container rounded-full flex items-center justify-center font-bold">
                      {d.initial}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold">{d.name}</div>
                      <div className="text-[10px] opacity-70">{d.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Position */}
            <div className="lg:col-span-2 bg-surface-container-high rounded-3xl p-6 hover:scale-[1.02] transition-transform duration-500">
              <h4 className="text-sm font-bold text-on-surface-variant uppercase tracking-widest mb-4">ポジション</h4>
              <div className="text-3xl font-extrabold text-primary">High Tier</div>
              <p className="text-xs text-on-surface-variant mt-2">同業種124社中 12位</p>
            </div>

            {/* Alerts */}
            <div className="lg:col-span-2 bg-tertiary-fixed-dim rounded-3xl p-6 hover:scale-[1.02] transition-transform duration-500">
              <div className="flex items-center gap-2 text-on-tertiary-fixed font-bold mb-2">
                <span className="material-symbols-outlined text-sm">notifications_active</span>
                Alerts
              </div>
              <div className="text-4xl font-extrabold text-on-tertiary-fixed">08</div>
              <p className="text-xs text-on-tertiary-fixed-variant mt-2 font-medium">即対応が必要な競合の動き</p>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ━━ 5. Impact Numbers (Dark) ━━ */}
      <LpSection className="py-24 bg-[#0b1c30] text-white px-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500 opacity-20 blur-[120px]" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tighter mb-8">導入後の圧倒的な変化</h2>
              <div className="space-y-6">
                <div className="flex items-center gap-6">
                  <div className="text-6xl font-extrabold text-emerald-400">-85%</div>
                  <div className="text-xl font-bold">競合調査に要する時間</div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-6xl font-extrabold text-amber-400">3.2倍</div>
                  <div className="text-xl font-bold">AIによる自動発見競合数</div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
              <h4 className="text-2xl font-bold mb-6 flex items-center gap-2 text-emerald-400">
                <span className="material-symbols-outlined">auto_awesome</span>
                月次レポート自動化
              </h4>
              <p className="text-white/70 leading-relaxed mb-6">
                これまでのレポート作成は過去のもの。Insight Studioは、データの収集からグラフ化、示唆の抽出までを自動で行います。あなたは戦略を決定するだけ。
              </p>
              <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 w-[92%]" />
              </div>
              <div className="flex justify-between mt-2 text-xs font-bold opacity-60">
                <span>効率化率</span>
                <span>92%達成</span>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ━━ 6. Testimonials ━━ */}
      <LpSection stagger className="py-24 bg-white px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-extrabold tracking-tighter">多くのリーダーに選ばれています</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="glass-card p-8 rounded-2xl border border-outline-variant/20 shadow-xl shadow-on-surface/5 hover:-translate-y-2 transition-all duration-300"
              >
                <div className="flex text-amber-500 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                      star
                    </span>
                  ))}
                </div>
                <p className="text-on-surface-variant italic mb-6">{t.text}</p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-200 rounded-full" />
                  <div>
                    <div className="font-bold text-sm">{t.name}</div>
                    <div className="text-xs text-on-surface-variant">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Logo marquee */}
          <div className="flex justify-center gap-12 text-on-surface-variant/40 font-bold tracking-widest text-sm">
            {logos.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ━━ 7. CTA ━━ */}
      <LpSection className="py-24 px-8">
        <div className="max-w-5xl mx-auto bg-gradient-to-r from-emerald-900 to-emerald-700 rounded-[3rem] p-12 lg:p-24 text-center relative overflow-hidden shadow-2xl">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
              backgroundSize: '32px 32px',
            }}
          />
          <div className="relative z-10">
            <h2 className="text-4xl lg:text-6xl font-extrabold text-white tracking-tighter mb-8">
              競合の動きを、見逃さない。
            </h2>
            <p className="text-white/80 text-xl mb-12 max-w-2xl mx-auto font-medium">
              今すぐInsight Studioを始めて、市場の全貌を把握しましょう。
            </p>
            <div className="flex flex-col items-center gap-6">
              <Link
                to="/"
                className="bg-emerald-400 text-emerald-950 px-12 py-5 rounded-xl font-bold text-xl lp-animate-glow hover:scale-105 transition-all"
              >
                無料で競合分析を始める
              </Link>
              <p className="text-white/60 text-sm">* クレジットカード登録不要、初期費用0円</p>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ━━ 8. FAQ ━━ */}
      <LpSection className="py-24 bg-surface-container-low px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-extrabold tracking-tighter">よくある質問</h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <FaqItem key={i} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </div>
      </LpSection>
    </>
  )
}

/* ── FAQ Accordion Item ── */
function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-outline-variant/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-6 text-left font-bold text-lg flex justify-between items-center hover:text-primary transition-colors"
        aria-expanded={open}
      >
        {question}
        <span
          className="material-symbols-outlined transition-transform duration-300"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>
      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: open ? '200px' : '0px',
          opacity: open ? 1 : 0,
        }}
      >
        <p className="px-6 pb-6 text-on-surface-variant leading-relaxed">{answer}</p>
      </div>
    </div>
  )
}
