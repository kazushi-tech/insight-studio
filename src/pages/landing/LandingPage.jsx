import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

const problems = [
  {
    icon: 'visibility_off',
    title: '競合の動きが見えない',
    body: '他社LPやクリエイティブの変化に気づけず、対策が後手に。',
  },
  {
    icon: 'schedule',
    title: 'レポート作成に時間がかかる',
    body: '毎週の分析レポートに数時間。本来の施策立案に集中できない。',
  },
  {
    icon: 'psychology_alt',
    title: '数値の"なぜ"が分からない',
    body: 'CPAが悪化しても原因特定に時間がかかり、改善が遅れる。',
  },
  {
    icon: 'hub',
    title: 'ツールが分散している',
    body: '競合調査・クリエイティブ管理・分析が別々で、全体像が掴めない。',
  },
]

const features = [
  {
    title: '競合LP比較',
    body: '競合のランディングページをAIが自動キャプチャ・比較分析。訴求軸やCTAの違いを一目で把握。',
    to: '/lp/compare',
    colSpan: 'md:col-span-8',
    rowSpan: 'md:row-span-2',
    hasImage: true,
  },
  {
    title: '競合ディスカバリー',
    body: '業界・キーワードから競合を自動発見。新規参入や出稿傾向の変化をリアルタイムで通知。',
    to: '/lp/discovery',
    colSpan: 'md:col-span-4',
    rowSpan: '',
  },
  {
    title: 'クリエイティブ診断',
    body: 'AIが広告クリエイティブのスコアリングと改善提案を自動生成。',
    to: '/lp/creative',
    colSpan: 'md:col-span-4',
    rowSpan: '',
  },
  {
    title: '広告パフォーマンス考察',
    body: 'KPIの変動要因をAIが自動分析。数値の裏にある"なぜ"を解き明かします。',
    to: '/lp/performance',
    colSpan: 'md:col-span-6',
    rowSpan: '',
  },
  {
    title: 'AI Explorer',
    body: '自然言語で広告データに質問。複雑なクエリもAIが即座に回答します。',
    to: '#',
    colSpan: 'md:col-span-6',
    rowSpan: '',
    isPrimary: true,
  },
]

const differentiators = [
  {
    num: '01',
    title: 'AIネイティブな分析基盤',
    body: '単なるダッシュボードではなく、AIが自動で仮説生成・検証まで行います。人間の分析官のように"なぜ"を追求。',
  },
  {
    num: '02',
    title: '競合情報の自動収集',
    body: '手作業の競合調査は不要。LPキャプチャ、クリエイティブ収集、出稿状況モニタリングをすべて自動化。',
  },
  {
    num: '03',
    title: 'ワンプラットフォーム',
    body: '競合分析・クリエイティブ管理・パフォーマンス考察を一つの画面で完結。ツール間の行き来をゼロに。',
  },
]

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ── */}
      <LpSection className="relative overflow-hidden pt-32 pb-24 px-6">
        {/* Background blurs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-tertiary/6 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-primary-fixed/20 border border-primary/15 rounded-full px-5 py-2 mb-8">
              <span className="material-symbols-outlined text-primary text-base">auto_awesome</span>
              <span className="text-sm font-bold tracking-widest text-primary font-label">AI POWERED ANALYSIS</span>
            </div>

            {/* Headline */}
            <h1 className="font-headline text-4xl md:text-6xl lg:text-7xl font-extrabold text-on-surface leading-tight mb-8">
              広告運用の&ldquo;なぜ？&rdquo;を、
              <br />
              <span className="text-primary">AIが解き明かす。</span>
            </h1>

            <p className="font-body text-lg md:text-xl text-on-surface-variant max-w-2xl mx-auto mb-10 leading-relaxed">
              競合分析・クリエイティブ診断・パフォーマンス考察。
              <br className="hidden md:block" />
              広告運用に必要なすべての分析を、AIがワンストップで。
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 px-10 py-5 bg-primary text-white rounded-2xl font-extrabold text-lg shadow-xl shadow-primary/25 hover:-translate-y-1 transition-all"
              >
                無料で始める
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </Link>
              <a
                href="#"
                className="inline-flex items-center justify-center gap-2 px-10 py-5 bg-white/80 text-primary border border-primary/20 rounded-2xl font-extrabold text-lg hover:bg-surface-container-low transition-all"
              >
                資料をダウンロード
                <span className="material-symbols-outlined text-xl">download</span>
              </a>
            </div>
          </div>

          {/* Dashboard mockup glass card */}
          <div className="relative max-w-4xl mx-auto">
            <div className="glass-card rounded-3xl p-3 shadow-2xl">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDsKVptWyBCrm4gxoVFJKcvV1WqwgfhCwpVeHDnxLqy-FJF-3F7TaaBkHPHvgjrpjraCb9P9Y6_v-b5IUl9jQpTRfKCm9TU1Z5J5KuZwshN8Q1xfI9NJHbQpn__hDXAyf0EYQ7jBdjWULBWnl2HQww_-u1_Pl5g7uHYfbVOBRhJ_mKd9xpfIi2TvPCidYETotbdFKR25-SEOQ2sVgvTbM4IbP8-5WT4LM3wXPAOzP8P9pSJIkBW8GTx5nSUAcVGqLf8jn7J--p3WoT7eQxvfI"
                alt="Insight Studio ダッシュボード"
                className="w-full rounded-2xl"
              />
            </div>
            {/* ROAS badge */}
            <div className="absolute -bottom-4 -right-4 md:-bottom-6 md:-right-6 bg-white rounded-2xl shadow-xl p-4 md:p-5 border border-primary/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary-fixed/40 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-xl md:text-2xl">trending_up</span>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">ROAS</p>
                  <p className="text-xl md:text-2xl font-extrabold text-primary">+142%</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Problem Section ── */}
      <LpSection className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">CHALLENGES</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-on-surface leading-tight">
              広告運用チームが直面する
              <br className="hidden md:block" />
              4つの課題
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {problems.map((p, i) => (
              <div
                key={i}
                className="bg-white rounded-3xl p-8 shadow-sm border border-outline-variant/60 hover:shadow-lg hover:-translate-y-1 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-primary-fixed/20 flex items-center justify-center mb-6">
                  <span className="material-symbols-outlined text-primary text-2xl">{p.icon}</span>
                </div>
                <h3 className="font-headline text-lg font-bold text-on-surface mb-3">{p.title}</h3>
                <p className="font-body text-sm text-on-surface-variant leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ── Features Bento Grid ── */}
      <LpSection id="features" className="py-24 px-6 bg-surface-container-low">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">FEATURES</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-on-surface leading-tight">
              Insight Studio の主要機能
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-auto">
            {features.map((f, i) => (
              <Link
                key={i}
                to={f.to}
                className={`group rounded-3xl p-8 transition-all hover:shadow-xl hover:-translate-y-1 ${f.colSpan} ${f.rowSpan} ${
                  f.isPrimary
                    ? 'bg-primary text-white'
                    : 'bg-white border border-outline-variant/60'
                }`}
              >
                <div className="flex flex-col h-full">
                  <h3
                    className={`font-headline text-xl font-bold mb-3 ${
                      f.isPrimary ? 'text-white' : 'text-on-surface'
                    }`}
                  >
                    {f.title}
                  </h3>
                  <p
                    className={`font-body text-sm leading-relaxed mb-6 ${
                      f.isPrimary ? 'text-primary-fixed/80' : 'text-on-surface-variant'
                    }`}
                  >
                    {f.body}
                  </p>
                  {f.hasImage && (
                    <div className="mt-auto rounded-2xl overflow-hidden">
                      <img
                        src="https://lh3.googleusercontent.com/aida-public/AB6AXuDsKVptWyBCrm4gxoVFJKcvV1WqwgfhCwpVeHDnxLqy-FJF-3F7TaaBkHPHvgjrpjraCb9P9Y6_v-b5IUl9jQpTRfKCm9TU1Z5J5KuZwshN8Q1xfI9NJHbQpn__hDXAyf0EYQ7jBdjWULBWnl2HQww_-u1_Pl5g7uHYfbVOBRhJ_mKd9xpfIi2TvPCidYETotbdFKR25-SEOQ2sVgvTbM4IbP8-5WT4LM3wXPAOzP8P9pSJIkBW8GTx5nSUAcVGqLf8jn7J--p3WoT7eQxvfI"
                        alt="競合LP比較画面"
                        className="w-full rounded-2xl group-hover:scale-[1.02] transition-transform"
                      />
                    </div>
                  )}
                  {!f.hasImage && (
                    <div className="mt-auto flex items-center gap-1">
                      <span
                        className={`text-sm font-bold ${
                          f.isPrimary ? 'text-primary-fixed' : 'text-primary'
                        }`}
                      >
                        詳しく見る
                      </span>
                      <span
                        className={`material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform ${
                          f.isPrimary ? 'text-primary-fixed' : 'text-primary'
                        }`}
                      >
                        arrow_forward
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </LpSection>

      {/* ── Differentiation ── */}
      <LpSection className="py-24 px-6 bg-[#003d2a] text-white relative overflow-hidden">
        {/* Dot pattern overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-tertiary-fixed-dim mb-4 font-label">WHY INSIGHT STUDIO</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-white leading-tight">
              Insight Studio が選ばれる
              <br className="hidden md:block" />
              3つの理由
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-10">
              {differentiators.map((d, i) => (
                <div key={i} className="flex gap-6">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-tertiary-fixed-dim/20 flex items-center justify-center">
                    <span className="text-xl font-extrabold text-tertiary-fixed-dim font-headline">{d.num}</span>
                  </div>
                  <div>
                    <h3 className="font-headline text-xl font-bold text-white mb-2">{d.title}</h3>
                    <p className="font-body text-primary-fixed/70 leading-relaxed">{d.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-3xl overflow-hidden shadow-2xl">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuA5nfS5ZDjDClNvLV5mZ0KAOXyTnKJElnVHG9Ae0uu8V8OFVlJkjw-y5UE3tqDBj4Xn2FKXk64qbqP5BKuoKW5_bL9gOCB1YiqWxDJUKPg-0eBfLRWIZpRv0c-dAkZoWC0xFGJ4bYt4jQJbBq_1GsmvJz_wthW39HS1dnvMXLcUzqPQXM6FH6DKUVO7G63LFXqOl2lK8l7Ox2l3o5YgOmpUKnb0OYxc_cLlsS3oK4YD_o-xKX4w2wZLcJxcaGfKzofpV1vBJm_dkT6iYGOg"
                alt="チームで分析するイメージ"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── CTA ── */}
      <LpCta />
    </>
  )
}
