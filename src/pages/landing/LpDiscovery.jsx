import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

export default function LpDiscovery() {
  return (
    <>
      {/* ── Hero ── */}
      <LpSection className="px-6 md:px-20 py-20 md:py-32 flex flex-col md:flex-row items-center justify-between gap-12 bg-surface">
        <div className="max-w-2xl">
          <h1 className="font-headline text-4xl md:text-6xl font-extrabold text-primary leading-tight mb-6">
            まだ気づいていない競合、
            <br />
            見逃していませんか？
          </h1>
          <p className="font-body text-lg md:text-xl text-on-surface-variant mb-10 leading-relaxed">
            URLを入力するだけで、AIが関連する競合サイトを自動で発見。
            <br className="hidden md:block" />
            市場の全体像を把握し、戦略の盲点をゼロにします。
          </p>
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="bg-primary text-on-primary px-8 py-4 rounded-xl text-lg font-bold shadow-lg hover:shadow-xl transition-all active:scale-95"
            >
              無料で始める
            </Link>
            <Link
              to="#"
              className="border border-primary text-primary px-8 py-4 rounded-xl text-lg font-bold hover:bg-primary/5 transition-all"
            >
              詳しく見る
            </Link>
          </div>
        </div>

        {/* Circular hero image */}
        <div className="relative w-full max-w-lg aspect-square bg-surface-container-high rounded-full overflow-hidden shadow-2xl flex items-center justify-center p-8">
          <img
            alt="Competitor Map visualization"
            className="w-full h-full object-cover rounded-full mix-blend-multiply opacity-80"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuA6O0atYUNdk1gvQ_Kd1A2efb1k6NJd2uWBmLkiI1MJS3OkR8O_QWlOkpEg8JqFsHogaSKdvvcep2gHHq-3A7GsZTzO0FLHQpJtmXFYVpocoIe5CgfkcxOzdPQc526O38uZzDlMosS65EMfvBPsIouqeYVzdAKFmiFKcw-M9MnackgBTEiAjo51pvJpB0wuq-jN8mkP1l4U0ARN_lA3Pj5wGuxhTOWZ5XlZksDfCdcqgM08W01E33uPWVJcljhBI4-RDzcrU2pXjsU"
          />
          {/* Floating badge */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-primary/20 flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-3xl">radar</span>
              <div>
                <p className="text-xs font-bold text-primary uppercase tracking-wider">
                  AI Discovery
                </p>
                <p className="font-body text-sm font-semibold">12 new competitors found</p>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Logic Flow ── */}
      <LpSection className="py-24 bg-surface-container-low px-6">
        <div className="max-w-5xl mx-auto text-center mb-16">
          <h2 className="font-headline text-3xl font-bold mb-4">ディスカバリーの仕組み</h2>
          <p className="font-body text-on-surface-variant">
            独自のアルゴリズムが、表面的なキーワードを超えて市場をスキャンします
          </p>
        </div>

        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Input */}
          <div className="flex-1 flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border border-outline-variant/30">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-primary text-4xl">link</span>
            </div>
            <h3 className="font-bold text-lg mb-2">入力</h3>
            <p className="font-body text-sm text-on-surface-variant text-center">
              調査したいサイトのURLやキーワードを入力
            </p>
          </div>

          <div className="hidden md:block">
            <span className="material-symbols-outlined text-outline-variant text-4xl">
              trending_flat
            </span>
          </div>

          {/* AI Processing */}
          <div className="flex-1 flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border border-outline-variant/30 relative">
            <div className="absolute -top-4 bg-tertiary text-on-tertiary px-4 py-1 rounded-full text-xs font-bold">
              AI Core
            </div>
            <div className="w-16 h-16 rounded-full bg-tertiary/10 flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-tertiary text-4xl">neurology</span>
            </div>
            <h3 className="font-bold text-lg mb-2">AI処理</h3>
            <p className="font-body text-sm text-on-surface-variant text-center">
              業界、訴求軸、ユーザー層を多角的に探索
            </p>
          </div>

          <div className="hidden md:block">
            <span className="material-symbols-outlined text-outline-variant text-4xl">
              trending_flat
            </span>
          </div>

          {/* Output */}
          <div className="flex-1 flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border border-outline-variant/30">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-primary text-4xl">analytics</span>
            </div>
            <h3 className="font-bold text-lg mb-2">出力</h3>
            <p className="font-body text-sm text-on-surface-variant text-center">
              類似度スコア付きの競合リストを生成
            </p>
          </div>
        </div>
      </LpSection>

      {/* ── 3-Step Guide ── */}
      <LpSection className="py-24 px-6 max-w-7xl mx-auto">
        <h2 className="font-headline text-3xl font-bold text-center mb-16">使い方3ステップ</h2>

        <div className="grid md:grid-cols-3 gap-12">
          {[
            {
              icon: 'keyboard',
              num: 1,
              title: '自社URLを入力',
              desc: 'まずはあなたのサイトURLを入力してください。AIが自動的にビジネスモデルを解析します。',
            },
            {
              icon: 'travel_explore',
              num: 2,
              title: 'AIが市場をスキャン',
              desc: 'ウェブ全体から類似性の高いプロダクトやサービスを抽出し、見落とされている競合を特定します。',
            },
            {
              icon: 'map',
              num: 3,
              title: '競合マップを確認',
              desc: '視覚化されたポジションマップで、自社の立ち位置と競合との距離をひと目で把握できます。',
            },
          ].map((step) => (
            <div key={step.num} className="text-center group">
              <div className="relative inline-block mb-6">
                <div className="w-20 h-20 bg-surface-container rounded-3xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <span className="material-symbols-outlined text-primary text-4xl">
                    {step.icon}
                  </span>
                </div>
                <div className="absolute -right-2 -bottom-2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold">
                  {step.num}
                </div>
              </div>
              <h4 className="font-bold text-xl mb-4">{step.title}</h4>
              <p className="font-body text-on-surface-variant leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </LpSection>

      {/* ── Dashboard Mockup ── */}
      <LpSection className="py-24 bg-surface-container-highest/30 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header + filter badges */}
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div>
              <h2 className="font-headline text-3xl font-bold mb-2">Discovery Result</h2>
              <p className="font-body text-on-surface-variant">
                解析完了：新たに{' '}
                <span className="text-primary font-bold">12サイト</span>{' '}
                の潜在的競合が発見されました
              </p>
            </div>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-white border border-outline-variant text-xs font-bold rounded-full">
                Similar Score: High
              </span>
              <span className="px-3 py-1 bg-white border border-outline-variant text-xs font-bold rounded-full">
                Status: New Discovery
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Sidebar — competitor cards */}
            <div className="md:col-span-1 flex flex-col gap-4 overflow-y-auto max-h-[600px] pr-2">
              {/* Card 1 */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-primary/10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-stone-100 rounded-lg overflow-hidden">
                    <img
                      alt="Terra-Solution.io logo"
                      className="w-full h-full object-cover"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuDrU_ER-Gk7UwP1ohjSHKhfMoOtYH3xJQ8StYVnLWW1G3vGg5sVWHxjdXLvr709AKdq7onnfq7_qCxxjtGU61ak0EwCq7ghHT9fzJEWZ1ZUx_fUhF7sbQ_v5sZ6VcNFVRStp8cFAYk_sGli1p2wNwVGXWXMEugerwBRXqpXp94-WM3ndKhkmYlwCH1-TZiQJS78d0dCt3SXq1fSFwfjvZjc5cLaDfvbpQQOeO8P__lC8_f7LXuhahZw5-maTrMWFPgrjWlXvGnuQVE"
                    />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm">Terra-Solution.io</h5>
                    <p className="text-[10px] text-on-surface-variant">SaaS / Enterprise</p>
                  </div>
                  <div className="ml-auto bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-bold">
                    92% Match
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  <span className="bg-surface-container px-2 py-0.5 rounded text-[10px]">
                    AI Integration
                  </span>
                  <span className="bg-surface-container px-2 py-0.5 rounded text-[10px]">
                    Marketing
                  </span>
                </div>
              </div>

              {/* Card 2 */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-transparent">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-stone-100 rounded-lg overflow-hidden">
                    <img
                      alt="Insight-Flow logo"
                      className="w-full h-full object-cover"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuDXWdHhSKkTYwtlCDs-xa3iBIbNAjg-EiMQSJnzOrvotz8HOKWqU_JfwNZqw3gt4u_u2tjtxYhhXkgz2ZpyGMFCasjKEaJjuYGEQVVOTOarJXW3m6BtWDBGw_HLSlZNU2P4EjQz1KgCfh1OueYvWeQo48ECS-N1LBEFOLWQMLgGVD0yrsFpv3Oxp14A2IsW7_QOPVmah0g5J0q9LqDiPgaaYUeLeczpRQVKIF6z-M2kENjgaQHs2PlIy28o8Vve3I4qD6z4Wn_Zb8o"
                    />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm">Insight-Flow</h5>
                    <p className="text-[10px] text-on-surface-variant">Analytics / Data</p>
                  </div>
                  <div className="ml-auto bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-bold">
                    88% Match
                  </div>
                </div>
              </div>

              {/* Card 3 */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-transparent opacity-60">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-stone-100 rounded-lg overflow-hidden">
                    <img
                      alt="Global-Scope.jp logo"
                      className="w-full h-full object-cover"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuBM09-Z2vRKBjfDMTD74Nt1BabOh6GeN-U-IRq3Yynpb6JRBt7na5YhglZgIIA35Bq66-2S50n34EvoZZoV_BfFNRx6lBdPnnZwScFeSgCdOapEhRSBRNHI91cjZnGKTFq72C_90YcekdqFbA4q245VbzbagfIeR7YsqJ70nMMj0AAb8V80vwaHCoqcuJDKjLKTTmbNjhfRIl-tMlOJrdQ3mnoRQ7mrPUhVFcKniJ637r_EJ9tE3WMc8FcY4MathP7-uBTsRbEP5t4"
                    />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm">Global-Scope.jp</h5>
                    <p className="text-[10px] text-on-surface-variant">Consulting</p>
                  </div>
                  <div className="ml-auto bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-bold">
                    75% Match
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Map */}
            <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-outline-variant/30 p-8 relative overflow-hidden">
              {/* Dot grid bg */}
              <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage:
                      'radial-gradient(#4a7c59 1px, transparent 1px)',
                    backgroundSize: '30px 30px',
                  }}
                />
              </div>

              <div className="relative h-full flex flex-col min-h-[400px]">
                <div className="flex justify-between text-[10px] text-on-surface-variant font-bold uppercase tracking-widest mb-4">
                  <span>High Cost</span>
                  <span>Low Cost</span>
                </div>

                <div className="flex-grow flex items-center justify-center relative">
                  {/* Self */}
                  <div className="z-10 w-24 h-24 bg-primary text-white rounded-full flex flex-col items-center justify-center shadow-xl ring-8 ring-primary/10">
                    <span className="text-[10px] font-bold">YOU</span>
                    <span className="text-xs font-bold">Insight Studio</span>
                  </div>

                  {/* Competitors */}
                  <div className="absolute top-10 left-1/4 w-16 h-16 bg-surface-container rounded-full flex items-center justify-center border-2 border-primary/20 animate-pulse">
                    <span className="text-[8px] font-bold">Comp A</span>
                  </div>
                  <div className="absolute bottom-20 right-1/4 w-20 h-20 bg-surface-container rounded-full flex items-center justify-center border-2 border-primary/20">
                    <span className="text-[8px] font-bold">Comp B</span>
                  </div>
                  <div className="absolute top-1/4 right-10 w-12 h-12 bg-surface-container rounded-full flex items-center justify-center border-2 border-primary/20">
                    <span className="text-[8px] font-bold">Comp C</span>
                  </div>
                  <div className="absolute bottom-10 left-10 w-14 h-14 bg-surface-container rounded-full flex items-center justify-center border-2 border-primary/20">
                    <span className="text-[8px] font-bold">Comp D</span>
                  </div>
                </div>

                <div className="flex justify-between text-[10px] text-on-surface-variant font-bold uppercase tracking-widest mt-4">
                  <span>Niche Focus</span>
                  <span>General Market</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Use Cases ── */}
      <LpSection className="py-24 px-6 max-w-7xl mx-auto">
        <h2 className="font-headline text-3xl font-bold text-center mb-16">
          あらゆる変化をキャッチアップ
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: 'new_releases',
              title: '新規参入の競合を早期発見',
              desc: 'リリースされたばかりのスタートアップや隠れた新機能、急成長中のサービスを常時監視します。',
            },
            {
              icon: 'shuffle',
              title: '異業種からの参入も見逃さない',
              desc: '既存のカテゴリーに囚われず、ユーザーの「代替手段」となっている異業種サービスの動きを捕捉。',
            },
            {
              icon: 'location_searching',
              title: '市場ポジショニングの把握',
              desc: '競合がどの市場セグメントを攻めているのか。自社との差別化ポイントを明確に可視化します。',
            },
          ].map((uc) => (
            <div
              key={uc.icon}
              className="bg-white p-8 rounded-2xl border border-outline-variant/30 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
            >
              <span className="material-symbols-outlined text-primary text-5xl mb-6">
                {uc.icon}
              </span>
              <h3 className="font-bold text-xl mb-4">{uc.title}</h3>
              <p className="font-body text-on-surface-variant">{uc.desc}</p>
            </div>
          ))}
        </div>
      </LpSection>

      {/* ── CTA ── */}
      <LpCta
        variant="dark"
        heading="あなたの競合、すべて把握できていますか？"
        body="AIの力で、明日からの戦略が変わる。まずは1分間の無料スキャンから。"
        primaryLabel="無料で競合を発見する"
        secondaryLabel={null}
      />
    </>
  )
}
