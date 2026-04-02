import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

export default function LpPerformance() {
  return (
    <>
      {/* Hero Section */}
      <LpSection className="relative pt-16 pb-24 px-8 overflow-hidden">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="z-10">
            <h1 className="font-headline text-5xl lg:text-6xl font-extrabold text-primary leading-tight mb-8">
              数字の裏にある"なぜ"を、<br />AIが読み解く。
            </h1>
            <p className="font-body text-xl text-on-surface-variant leading-relaxed mb-10 max-w-xl">
              Google Ads等の広告データを接続するだけ。AIがパフォーマンスの変動要因を分析し、次のアクションを提案します。
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/"
                className="bg-primary text-on-primary px-8 py-4 rounded-xl font-bold text-lg shadow-lg hover:opacity-90 transition-all text-center"
              >
                無料で体験を開始
              </Link>
              <Link
                to="#"
                className="bg-white border-2 border-primary text-primary px-8 py-4 rounded-xl font-bold text-lg hover:bg-primary-container/10 transition-all text-center"
              >
                デモを見る
              </Link>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-10 bg-primary/5 rounded-full blur-3xl" />
            <div className="relative bg-surface-container rounded-2xl shadow-2xl p-6 border border-outline-variant/30 overflow-hidden transform hover:-translate-y-2 transition-transform duration-500">
              <div className="flex justify-between items-center mb-6 border-b border-outline-variant/20 pb-4">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-error/40" />
                  <div className="w-3 h-3 rounded-full bg-tertiary/40" />
                  <div className="w-3 h-3 rounded-full bg-primary/40" />
                </div>
                <span className="font-body text-xs font-bold text-on-surface-variant uppercase tracking-widest">
                  Dashboard Mockup
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="font-body text-xs text-on-surface-variant mb-1">ROAS</p>
                  <p className="font-headline text-2xl font-bold text-primary">340%</p>
                  <p className="font-body text-[10px] text-error font-bold">↓ 12.5% vs last week</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="font-body text-xs text-on-surface-variant mb-1">CPA</p>
                  <p className="font-headline text-2xl font-bold text-primary">¥1,250</p>
                  <p className="font-body text-[10px] text-error font-bold">↑ 15% vs last week</p>
                </div>
              </div>
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl mb-4">
                <div className="flex gap-2 items-start">
                  <span
                    className="material-symbols-outlined text-primary text-sm mt-1"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    smart_toy
                  </span>
                  <div className="text-sm">
                    <p className="font-headline font-bold text-primary mb-1 leading-none">AI Insight</p>
                    <p className="font-body text-on-surface">
                      CPAが上昇しています。競合他社の入札強化が原因の可能性があります。リマーケティング設定の再確認を推奨します。
                    </p>
                  </div>
                </div>
              </div>
              <img
                className="w-full h-40 object-cover rounded-lg shadow-inner opacity-80"
                alt="Dashboard data visualization showing a line graph and digital statistics"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDT7j2VMo1KSrok1zMKvaKZaGXUOP5kPp1SS7ybxiF0Mh7kAOzUlYi2pJ9R1qL5LOl27-dmXqAbogBGyhKiqKt16ALy-6MUr6RKt60oxqsVs8M39S85-8hy0jR8iWEhbUTBkVzgDRFa5ZApdx7wVOzYl0nlDNFQkWijDLZdlqXjoXvTvt7dsy6WMF711DCG4M3pp8voe_FtGMdKYuiE6fkPApl8_J1ix_3tV1ey-ba-ZFnPpIGssC9D3wN5nDVcW7GQL4-FMlwOVxg"
              />
            </div>
          </div>
        </div>
      </LpSection>

      {/* Feature Overview */}
      <LpSection className="py-24 bg-surface-container-low px-8">
        <div className="max-w-7xl mx-auto text-center mb-16">
          <h2 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-4">
            単なるレポートではなく「考察」を自動生成
          </h2>
          <div className="h-1 w-20 bg-primary mx-auto" />
        </div>
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-primary text-4xl">analytics</span>
            </div>
            <h3 className="font-headline text-xl font-bold mb-4">変動要因の特定</h3>
            <p className="font-body text-on-surface-variant leading-relaxed">
              「なぜ数字が動いたか」を、複雑なデータからAIが即座に見つけ出します。
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-primary text-4xl">psychology</span>
            </div>
            <h3 className="font-headline text-xl font-bold mb-4">高度な考察ロジック</h3>
            <p className="font-body text-on-surface-variant leading-relaxed">
              業界トレンドや季節要因を加味し、人間と同等以上の深い考察を提示します。
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-primary text-4xl">assignment_turned_in</span>
            </div>
            <h3 className="font-headline text-xl font-bold mb-4">具体的な次の一手</h3>
            <p className="font-body text-on-surface-variant leading-relaxed">
              分析して終わりではありません。予算配分やクリエイティブの改善案を具体的に示します。
            </p>
          </div>
        </div>
      </LpSection>

      {/* 3 Steps */}
      <LpSection className="py-24 px-8 bg-surface">
        <div className="max-w-7xl mx-auto">
          <h2 className="font-headline text-3xl font-bold text-center mb-16">
            3ステップで改善サイクルを加速
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-outline-variant/30 -z-10" />
            {/* Step 1 */}
            <div className="bg-white p-8 rounded-2xl shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20">
              <div className="w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center text-xl font-bold mb-6">
                1
              </div>
              <span className="material-symbols-outlined text-tertiary mb-4 text-3xl">hub</span>
              <h4 className="font-headline text-xl font-bold mb-2">広告アカウントを接続</h4>
              <p className="font-body text-on-surface-variant text-sm">
                Google, Meta, Yahooなどの主要プラットフォームとAPI連携。数クリックで完了します。
              </p>
            </div>
            {/* Step 2 */}
            <div className="bg-white p-8 rounded-2xl shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20">
              <div className="w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center text-xl font-bold mb-6">
                2
              </div>
              <span className="material-symbols-outlined text-tertiary mb-4 text-3xl">auto_awesome</span>
              <h4 className="font-headline text-xl font-bold mb-2">AIが自動で分析・考察</h4>
              <p className="font-body text-on-surface-variant text-sm">
                接続されたデータをAIが24時間スキャン。異常値や機会損失をリアルタイムで見つけます。
              </p>
            </div>
            {/* Step 3 */}
            <div className="bg-white p-8 rounded-2xl shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20">
              <div className="w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center text-xl font-bold mb-6">
                3
              </div>
              <span className="material-symbols-outlined text-tertiary mb-4 text-3xl">insights</span>
              <h4 className="font-headline text-xl font-bold mb-2">レポートとアクションを確認</h4>
              <p className="font-body text-on-surface-variant text-sm">
                整理されたダッシュボードで結果を確認。提案された改善策を実行に移すだけです。
              </p>
            </div>
          </div>
        </div>
      </LpSection>

      {/* Analysis Dashboard Mockup */}
      <LpSection className="py-24 px-8 bg-surface-container-low">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-headline text-3xl font-bold mb-4">直感的な Analysis Dashboard</h2>
            <p className="font-body text-on-surface-variant">あなたの広告パフォーマンスを、AIの視点で可視化します。</p>
          </div>
          <div className="bg-surface-container-low rounded-3xl p-8 md:p-12 shadow-2xl border border-primary/10">
            {/* Metrics row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="p-6 bg-white rounded-xl shadow-sm border-l-4 border-primary">
                <p className="font-body text-xs font-bold text-on-surface-variant uppercase mb-2">Conversion Rate</p>
                <p className="font-headline text-3xl font-bold text-on-surface">3.8%</p>
                <div className="flex items-center gap-1 mt-2 text-primary font-bold text-xs">
                  <span className="material-symbols-outlined text-sm">trending_up</span>
                  <span>+0.4%</span>
                </div>
              </div>
              <div className="p-6 bg-white rounded-xl shadow-sm border-l-4 border-primary">
                <p className="font-body text-xs font-bold text-on-surface-variant uppercase mb-2">Avg. CPA</p>
                <p className="font-headline text-3xl font-bold text-on-surface">¥1,850</p>
                <div className="flex items-center gap-1 mt-2 text-error font-bold text-xs">
                  <span className="material-symbols-outlined text-sm">trending_up</span>
                  <span>+15% vs last week</span>
                </div>
              </div>
              <div className="p-6 bg-white rounded-xl shadow-sm border-l-4 border-primary">
                <p className="font-body text-xs font-bold text-on-surface-variant uppercase mb-2">Total ROAS</p>
                <p className="font-headline text-3xl font-bold text-on-surface">412%</p>
                <div className="flex items-center gap-1 mt-2 text-primary font-bold text-xs">
                  <span className="material-symbols-outlined text-sm">trending_up</span>
                  <span>+22%</span>
                </div>
              </div>
            </div>

            {/* 5-col grid: chart + AI comment */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
              <div className="lg:col-span-3 space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm h-64 flex flex-col justify-between">
                  <div className="flex justify-between items-center mb-4">
                    <h5 className="font-headline font-bold">Performance Trend</h5>
                    <div className="flex gap-2">
                      <span className="w-3 h-3 bg-primary rounded-full" />
                      <span className="w-3 h-3 bg-outline-variant rounded-full" />
                    </div>
                  </div>
                  <div className="flex-grow flex items-end gap-2">
                    <div className="w-full bg-primary/20 h-1/2 rounded-t" />
                    <div className="w-full bg-primary/40 h-2/3 rounded-t" />
                    <div className="w-full bg-primary/30 h-1/2 rounded-t" />
                    <div className="w-full bg-primary/60 h-3/4 rounded-t" />
                    <div className="w-full bg-primary/80 h-full rounded-t" />
                    <div className="w-full bg-primary h-5/6 rounded-t" />
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-primary/5 border border-primary/20 p-6 rounded-2xl relative">
                  <div className="absolute -top-4 -left-4 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white shadow-lg">
                    <span className="material-symbols-outlined text-xl">smart_toy</span>
                  </div>
                  <h5 className="font-headline font-bold text-primary mb-3">AI Analysis Comment</h5>
                  <p className="font-body text-sm text-on-surface leading-relaxed mb-4">
                    「CPAが先週比+15%上昇。原因：
                    <span className="font-bold border-b-2 border-primary/30">
                      競合Aの新キャンペーン開始による入札競争の激化
                    </span>
                    を確認しました。」
                  </p>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">
                      Recommended Actions
                    </p>
                    <div className="flex items-center gap-2 text-xs bg-white/50 p-2 rounded-lg border border-primary/10">
                      <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                      <span className="font-body">検索クエリの除外ワード追加</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs bg-white/50 p-2 rounded-lg border border-primary/10">
                      <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                      <span className="font-body">リターゲティング予算の20%増</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* Supported Platforms */}
      <LpSection className="py-16 px-8 border-y border-outline-variant/20 bg-white">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-body text-sm font-bold text-on-surface-variant/60 mb-10 tracking-[0.2em] uppercase">
            Supported Platforms
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-60 grayscale hover:grayscale-0 transition-all">
            <span className="text-2xl font-bold font-headline">Google Ads</span>
            <span className="text-2xl font-bold font-headline">Meta Ads</span>
            <span className="text-2xl font-bold font-headline">TikTok Ads</span>
            <span className="text-2xl font-bold font-headline">Yahoo! Japan</span>
            <span className="text-2xl font-bold font-headline">X Ads</span>
          </div>
        </div>
      </LpSection>

      {/* CTA Section */}
      <LpCta
        heading={'広告データの"なぜ？"を解明する'}
        body="今すぐアカウントを連携して、AIによる無料分析を開始しましょう。"
        primaryLabel="無料で始める"
        secondaryLabel={null}
      />
    </>
  )
}
