import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

export default function LpCompare() {
  return (
    <>
      {/* Hero Section */}
      <LpSection className="relative pt-20 pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-8 relative z-10">
          <div className="max-w-3xl">
            <span className="inline-block px-4 py-1.5 bg-secondary-container text-on-tertiary-container rounded-full text-sm font-label font-bold tracking-wider mb-6">
              COMPETITOR LP ANALYSIS
            </span>
            <h1 className="font-headline text-5xl md:text-7xl font-bold text-on-surface leading-[1.1] mb-8">
              競合LPを、<br />
              <span className="text-primary italic">AIが丸裸にする。</span>
            </h1>
            <p className="font-body text-xl text-on-surface-variant leading-relaxed mb-10">
              自社と競合のランディングページをAIが多角的に比較分析。構成からコピー、コンバージョン動線まで、勝てるLPの裏側を可視化します。
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/"
                className="bg-primary text-on-primary px-10 py-4 rounded-xl font-label font-extrabold text-lg shadow-lg hover:opacity-90 transition-all active:scale-95 text-center"
              >
                Start for Free
              </Link>
              <Link
                to="#"
                className="flex items-center justify-center gap-2 px-10 py-4 rounded-xl font-label font-bold text-lg text-primary border-2 border-primary/20 bg-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined">play_circle</span>
                デモを見る
              </Link>
            </div>
          </div>
        </div>
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-primary-container/10 -skew-x-12 transform origin-top translate-x-1/4 -z-0" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-tertiary-container/20 rounded-full blur-3xl -z-0" />
      </LpSection>

      {/* Feature Explanation */}
      <LpSection className="py-24 bg-surface-container-low">
        <div className="max-w-7xl mx-auto px-8">
          <div className="grid md:grid-cols-2 gap-20 items-center">
            <div className="relative">
              <div className="aspect-[4/3] bg-surface rounded-xl shadow-xl overflow-hidden border border-outline-variant/30">
                <img
                  className="w-full h-full object-cover"
                  alt="Modern split-screen interface showing two different landing pages side by side with AI analysis overlays and heatmaps"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAApIQ8g_fwBVPpTPtxbP8C0mJQ-J7OvipuIqQChdA_pNrlFv09asSMX9e_EIbtU-FX9bW027vONjsMNtbapoTGrm8lF_Y81V4p4VgnJfwp-ZKzUwPR25Jl6xcykMSAE6zF51KY3BHCioB23B36GrpUOijj1-AXw9SVfavsIB-HIZ-CdCSpsR6bhJD-RjBWnZXd_W0F4_3aHlJMXIasPBRTLkyumA0n8odyBJwmrAfroI0-Hjyae667iQEJmw-I4367SIJlYWCrtcU"
                />
              </div>
              <div className="absolute -bottom-6 -right-6 w-48 h-48 bg-primary text-on-primary p-6 rounded-xl shadow-2xl flex flex-col justify-center items-center text-center">
                <span className="material-symbols-outlined text-4xl mb-2">query_stats</span>
                <span className="text-sm font-bold">Side-by-Side Analysis</span>
              </div>
            </div>
            <div>
              <h2 className="font-headline text-4xl font-bold mb-8 text-on-surface">
                データに基づいた<br />圧倒的な比較優位性を。
              </h2>
              <p className="font-body text-on-surface-variant text-lg leading-relaxed mb-10">
                AIが両サイトの「ファーストビュー」「コンテンツ構造」「訴求軸」「CTA位置」をリアルタイムでスキャン。感覚的な評価ではなく、コンバージョンに直結する要素を数値とロジックで比較します。
              </p>
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="material-symbols-outlined text-primary text-lg">check</span>
                  </div>
                  <div>
                    <h3 className="font-headline font-bold text-on-surface">構成とコピーの差分抽出</h3>
                    <p className="font-body text-on-surface-variant text-sm">どのセクションがターゲットの心を掴んでいるかを言語化。</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="material-symbols-outlined text-primary text-lg">check</span>
                  </div>
                  <div>
                    <h3 className="font-headline font-bold text-on-surface">CTAパフォーマンス予測</h3>
                    <p className="font-body text-on-surface-variant text-sm">ボタンの文言や配置によるクリック率の違いをAIがシミュレーション。</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </LpSection>

      {/* 3-Step Guide */}
      <LpSection className="py-24 bg-surface">
        <div className="max-w-7xl mx-auto px-8 text-center mb-16">
          <h2 className="font-headline text-4xl font-bold text-on-surface mb-4">使い方</h2>
          <div className="w-20 h-1 bg-primary mx-auto" />
        </div>
        <div className="max-w-7xl mx-auto px-8">
          <div className="grid md:grid-cols-3 gap-12">
            <div className="relative p-8 bg-surface-container-high rounded-xl text-center group hover:shadow-lg transition-shadow">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                1
              </div>
              <div className="mb-6 pt-4">
                <span className="material-symbols-outlined text-5xl text-primary">link</span>
              </div>
              <h3 className="font-headline text-xl font-bold mb-4">URLを入力</h3>
              <p className="font-body text-on-surface-variant text-sm">比較したい自社と競合のLPのURLをフォームに入力するだけです。</p>
            </div>
            <div className="relative p-8 bg-surface-container-high rounded-xl text-center group hover:shadow-lg transition-shadow">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                2
              </div>
              <div className="mb-6 pt-4">
                <span className="material-symbols-outlined text-5xl text-primary">smart_toy</span>
              </div>
              <h3 className="font-headline text-xl font-bold mb-4">AIが自動分析</h3>
              <p className="font-body text-on-surface-variant text-sm">独自の解析エンジンが数秒でページ全体をスキャンし、各要素を分解します。</p>
            </div>
            <div className="relative p-8 bg-surface-container-high rounded-xl text-center group hover:shadow-lg transition-shadow">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 bg-primary text-on-primary rounded-full flex items-center justify-center font-bold text-xl shadow-md">
                3
              </div>
              <div className="mb-6 pt-4">
                <span className="material-symbols-outlined text-5xl text-primary">description</span>
              </div>
              <h3 className="font-headline text-xl font-bold mb-4">改善ポイントをレポート</h3>
              <p className="font-body text-on-surface-variant text-sm">競合に勝つために、今すぐ直すべき具体的な改善アクションを提示します。</p>
            </div>
          </div>
        </div>
      </LpSection>

      {/* Dashboard Mockup (Bento Grid Style) */}
      <LpSection className="py-24 bg-surface-container-lowest">
        <div className="max-w-7xl mx-auto px-8">
          <div className="mb-16 text-center">
            <h2 className="font-headline text-4xl font-bold mb-4">Analysis Result</h2>
            <p className="font-body text-on-surface-variant">直感的で高機能な分析ダッシュボード</p>
          </div>
          <div className="grid grid-cols-12 gap-6">
            {/* Main Preview */}
            <div className="col-span-12 lg:col-span-8 bg-white rounded-xl shadow-sm border border-outline-variant/30 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-error/40" />
                  <div className="w-3 h-3 rounded-full bg-tertiary/40" />
                  <div className="w-3 h-3 rounded-full bg-primary/40" />
                </div>
                <div className="px-4 py-1 bg-surface-container rounded-md text-xs font-bold text-on-surface-variant">
                  COMPETITOR SCORE: 88/100
                </div>
              </div>
              <div className="aspect-video bg-surface-container-low rounded-lg border border-dashed border-outline-variant flex items-center justify-center relative overflow-hidden">
                <img
                  className="w-full h-full object-cover opacity-80"
                  alt="Data visualization dashboard showing charts, conversion funnels, and landing page heatmaps"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDYe5wGtOJUvPmJ0v474bzj0UxzKpYbzgTd1YLap_T4TYSCqqko3e-df2cw-dXsUPA8MopnTouipxBlv_JVGodkpoXpyiEQMxfeUKuN9JF7rlN24erTNZG8_6swTVv3RS2EFHq7cHxOJPUogGBpj0LB3ynufe9gxguxUzjPKG8L9Ji2Y1ZoOxjitU_69VRAOANkDUzwMp9eOzbI1Y6WiS7F3k2mo7p1alhNwLIKS7wM5bjAftePQrCZ1l9-SVAG84tZwDhGN5Dk74g"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent" />
              </div>
            </div>

            {/* Stats Card 1 */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 bg-primary text-on-primary p-8 rounded-xl flex flex-col justify-between">
              <div>
                <span className="material-symbols-outlined text-3xl mb-4">trending_up</span>
                <h4 className="font-headline text-lg font-bold mb-2">想定CVR向上率</h4>
                <p className="text-4xl font-headline font-black">+14.2%</p>
              </div>
              <p className="text-sm opacity-80 mt-4">AI推奨の改善案を全て適用した場合の予測数値です。</p>
            </div>

            {/* Stats Card 2 */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 bg-tertiary-container text-on-tertiary-container p-8 rounded-xl">
              <h4 className="font-headline text-lg font-bold mb-4">重要改善項目</h4>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-on-tertiary-container/10 pb-2">
                  <span className="font-body">見出しの訴求</span>
                  <span className="bg-error text-on-error px-2 py-0.5 rounded text-xs font-bold">High</span>
                </div>
                <div className="flex justify-between items-center border-b border-on-tertiary-container/10 pb-2">
                  <span className="font-body">追従CTA導入</span>
                  <span className="bg-primary text-on-primary px-2 py-0.5 rounded text-xs font-bold">Mid</span>
                </div>
                <div className="flex justify-between items-center pb-2">
                  <span className="font-body">画像読み込み</span>
                  <span className="bg-primary text-on-primary px-2 py-0.5 rounded text-xs font-bold">Mid</span>
                </div>
              </div>
            </div>

            {/* Secondary Features Grid */}
            <div className="col-span-12 lg:col-span-8 grid grid-cols-2 gap-6">
              <div className="bg-surface-container-high p-6 rounded-xl border border-outline-variant/20">
                <h5 className="font-headline font-bold flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary">palette</span>
                  カラースキーム分析
                </h5>
                <div className="flex gap-1 mt-3">
                  <div className="w-8 h-8 rounded bg-[#4a7c59]" />
                  <div className="w-8 h-8 rounded bg-[#705c30]" />
                  <div className="w-8 h-8 rounded bg-[#faf6f0]" />
                  <div className="w-8 h-8 rounded bg-[#2e3230]" />
                </div>
              </div>
              <div className="bg-surface-container-high p-6 rounded-xl border border-outline-variant/20">
                <h5 className="font-headline font-bold flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary">bolt</span>
                  読み込み速度診断
                </h5>
                <div className="w-full bg-outline-variant/30 h-2 rounded-full mt-4">
                  <div className="bg-primary w-[92%] h-full rounded-full" />
                </div>
                <span className="font-body text-xs mt-2 inline-block">Score: 92/100 (Optimal)</span>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* Analysis Items Grid */}
      <LpSection className="py-24 bg-surface-container-low">
        <div className="max-w-7xl mx-auto px-8">
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="bg-surface p-8 rounded-xl shadow-sm hover:translate-y-[-4px] transition-transform">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-primary text-3xl">account_tree</span>
              </div>
              <h4 className="font-headline text-xl font-bold mb-4">ページ構造</h4>
              <p className="font-body text-on-surface-variant text-sm leading-relaxed">
                競合がどのような順序で情報を伝え、ユーザーの期待感を高めているかをセクションごとに解析。
              </p>
            </div>
            <div className="bg-surface p-8 rounded-xl shadow-sm hover:translate-y-[-4px] transition-transform">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-primary text-3xl">ads_click</span>
              </div>
              <h4 className="font-headline text-xl font-bold mb-4">訴求軸</h4>
              <p className="font-body text-on-surface-variant text-sm leading-relaxed">
                価格、品質、スピード、安心感。競合が最も強調している独自の強みをAIが特定。
              </p>
            </div>
            <div className="bg-surface p-8 rounded-xl shadow-sm hover:translate-y-[-4px] transition-transform">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-primary text-3xl">touch_app</span>
              </div>
              <h4 className="font-headline text-xl font-bold mb-4">CTA配置</h4>
              <p className="font-body text-on-surface-variant text-sm leading-relaxed">
                ボタンの色、サイズ、文言、そして設置タイミング。離脱を防ぐための最適な設計をアドバイス。
              </p>
            </div>
            <div className="bg-surface p-8 rounded-xl shadow-sm hover:translate-y-[-4px] transition-transform">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-primary text-3xl">smartphone</span>
              </div>
              <h4 className="font-headline text-xl font-bold mb-4">モバイル対応度</h4>
              <p className="font-body text-on-surface-variant text-sm leading-relaxed">
                スマホでの視認性、操作性、表示速度を徹底チェック。モバイルユーザーを逃さないUIを。
              </p>
            </div>
          </div>
        </div>
      </LpSection>

      {/* CTA Section */}
      <LpCta
        heading={"あなたのLPは、\n競合に勝てていますか？"}
        body="まずは無料でAIによるLP診断をお試しください。あなたのビジネスを次のステージへ。"
        primaryLabel="まずは無料で競合分析を試す"
        secondaryLabel={null}
      />
    </>
  )
}
