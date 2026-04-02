import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'

export default function LpCreative() {
  return (
    <>
      {/* ── Hero ── */}
      <LpSection className="px-8 py-20 max-w-7xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <span className="inline-block px-4 py-1.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-full text-sm font-semibold tracking-wide">
            AIクリエイティブ診断
          </span>
          <h1 className="font-headline text-5xl md:text-6xl font-bold text-on-surface leading-tight">
            「そのクリエイティブ、本当に刺さっていますか？」
          </h1>
          <p className="font-body text-xl text-on-surface-variant max-w-lg leading-relaxed">
            バナー・LP・広告クリエイティブの訴求力をAIが多角的に診断。感覚ではなくデータで改善。
          </p>
          <div className="flex gap-4 pt-4">
            <Link
              to="/"
              className="bg-primary text-white px-8 py-4 rounded-xl font-bold text-lg hover:shadow-lg transition-shadow"
            >
              無料で診断を開始する
            </Link>
            <Link
              to="#"
              className="bg-surface-container text-primary px-8 py-4 rounded-xl font-bold text-lg hover:bg-surface-container-high transition-colors"
            >
              資料ダウンロード
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 bg-primary/5 rounded-[2rem] blur-2xl" />
          <img
            className="relative rounded-xl shadow-xl w-full object-cover aspect-[4/3] border border-outline-variant/30"
            alt="Dashboard interface showing analytical data charts and creative report mockups"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAqrHvQldxQz_QSkukM81FR2hWUlLnwKRREljQLfvoABxXsY0oa3VWAlkMMejTt0FN1pqH2dNNpsMcCMrze3LYDK3Zd_0wjCYh7omzKR42PN376hQS_c3ZrfS_gKwfsM-YNeKWIBYHY1OAUJmTARBW4sJn9q1egtCU0_9saOO-1PYCrlT21wLR8XdlMTyAxTTGlIVp1Wv-4bcE_JtOeQJxSdqxzro8QBoTBkEDWH6sTwvD_j2GnEcIX_THk-V-yNqANKGKyRiGpE1g"
          />
        </div>
      </LpSection>

      {/* ── Overview / Radar ── */}
      <LpSection className="bg-surface-container-low py-24">
        <div className="max-w-7xl mx-auto px-8">
          <div className="text-center mb-16 space-y-4">
            <h2 className="font-headline text-4xl font-bold text-on-surface">診断の概要</h2>
            <p className="font-body text-on-surface-variant max-w-2xl mx-auto">
              AIが広告クリエイティブの「心理的インパクト」と「構造的品質」を、4つの評価軸でスコア化します。
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-16 items-center">
            {/* 2x2 evaluation cards */}
            <div className="grid grid-cols-2 gap-6">
              {[
                {
                  icon: 'energy_savings_leaf',
                  title: '訴求力',
                  desc: 'ユーザーの課題を解決するメッセージが含まれているか。',
                },
                {
                  icon: 'visibility',
                  title: '視認性',
                  desc: 'フォントサイズや色のコントラストが適切に保たれているか。',
                },
                {
                  icon: 'touch_app',
                  title: 'CTA効果',
                  desc: 'クリックを促す動線が明確で行動しやすい設計か。',
                },
                {
                  icon: 'verified',
                  title: 'ブランド一貫性',
                  desc: '企業のブランドイメージとデザインが合致しているか。',
                },
              ].map((card) => (
                <div
                  key={card.icon}
                  className="p-6 bg-white rounded-xl shadow-sm border border-outline-variant/20"
                >
                  <span className="material-symbols-outlined text-primary text-3xl mb-4">
                    {card.icon}
                  </span>
                  <h3 className="text-lg font-bold mb-2">{card.title}</h3>
                  <p className="font-body text-sm text-on-surface-variant">{card.desc}</p>
                </div>
              ))}
            </div>

            {/* Radar chart mockup */}
            <div className="relative aspect-square flex items-center justify-center p-8 bg-white rounded-[2rem] shadow-sm overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent" />
              <img
                className="w-full h-full object-contain rounded-lg"
                alt="Geometric radar chart visualization in forest green"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCSPGN5zH8AfbBWjgauvyyyMoXU8S-TTP2yQM99kB_cus88Fuankf0NTcMj4N9daowvetLuJupksr1KPc5wnFwCokuHr7mUTaIh9galAmx7bDLRmFgVG6qKqoglbh30d5C90O73eny14xRreca-1cKVUxp9H-qyOCxju_1-g4lojzD-6PqpNAfk36rzAz70et7EsncQbY3fqhuoDcOqpRAqSDkuTuY5LU0JVSsJg_9-n9vYzujmheVFYi-LufUfCS0ZVi26DTU-yiw"
              />
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Steps ── */}
      <LpSection className="py-24 px-8 max-w-7xl mx-auto">
        <h2 className="font-headline text-4xl font-bold text-center mb-16">
          使い方は簡単、3ステップ
        </h2>

        <div className="grid md:grid-cols-3 gap-12">
          {/* Step 01 */}
          <div className="relative group">
            <div className="mb-6 flex items-baseline gap-4">
              <span className="text-6xl font-headline font-bold text-primary/20 group-hover:text-primary/40 transition-colors">
                01
              </span>
              <h3 className="text-2xl font-bold">画像をアップロード</h3>
            </div>
            <p className="font-body text-on-surface-variant mb-6">
              診断したいバナー、LPのスクリーンショット、動画サムネイルをアップロードするだけ。
            </p>
            <div className="aspect-video rounded-xl bg-surface-container flex items-center justify-center border-2 border-dashed border-outline-variant">
              <span className="material-symbols-outlined text-outline text-4xl">upload_file</span>
            </div>
          </div>

          {/* Step 02 */}
          <div className="relative group">
            <div className="mb-6 flex items-baseline gap-4">
              <span className="text-6xl font-headline font-bold text-primary/20 group-hover:text-primary/40 transition-colors">
                02
              </span>
              <h3 className="text-2xl font-bold">AIが多角的に診断</h3>
            </div>
            <p className="font-body text-on-surface-variant mb-6">
              独自のAIエンジンが瞬時に解析。視線予測やテキスト分析を用いて診断を行います。
            </p>
            <div className="aspect-video rounded-xl bg-surface-container flex items-center justify-center border-2 border-dashed border-outline-variant overflow-hidden">
              <img
                className="w-full h-full object-cover opacity-80"
                alt="AI interface analyzing a digital poster with heatmap overlays"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuApeVghpTEA3DMguQ9GO1_oNmRasurd0udfXgtGLPf0r0D4RPlGYc8chQeQOWcM_2sE0s9MfEygJ2BQSt1_I4yz8sVKgrxAGYx8BOmecG0rNWqLjFVPOhjUCEI4Ttjb5Cz8i5TXPLkIkqoKrunEMJCgVGK6_7z7ZxM0CHtr1SSobuH8OORx5HznFuj6Tp8q2Fxh5TODSThe1GMxz9y_xjQSRqB3oj9VGPGUo2jb0GoBAU9VLR2-wixSGngmo3fXnYhQj-NraHMZzZo"
              />
            </div>
          </div>

          {/* Step 03 */}
          <div className="relative group">
            <div className="mb-6 flex items-baseline gap-4">
              <span className="text-6xl font-headline font-bold text-primary/20 group-hover:text-primary/40 transition-colors">
                03
              </span>
              <h3 className="text-2xl font-bold">改善提案を確認</h3>
            </div>
            <p className="font-body text-on-surface-variant mb-6">
              具体的な改善ポイントをリストアップ。何を、どう変えるべきか一目でわかります。
            </p>
            <div className="aspect-video rounded-xl bg-surface-container flex items-center justify-center border-2 border-dashed border-outline-variant">
              <span className="material-symbols-outlined text-outline text-4xl">task_alt</span>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Diagnosis Report Bento ── */}
      <LpSection className="bg-surface-container-high py-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-8">
          {/* Header + Score badge */}
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div className="space-y-4">
              <h2 className="font-headline text-4xl font-bold">診断レポート例</h2>
              <p className="font-body text-on-surface-variant">
                実際の診断結果画面のイメージです。具体的でアクション可能なデータを提供します。
              </p>
            </div>
            <div className="bg-white px-6 py-4 rounded-xl shadow-sm flex items-center gap-6">
              <div className="text-center">
                <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold">
                  Total Score
                </p>
                <p className="text-4xl font-bold text-primary">
                  72<span className="text-lg text-on-surface-variant font-normal">/100</span>
                </p>
              </div>
              <div className="h-10 w-[1px] bg-outline-variant/30" />
              <div className="text-sm font-semibold text-tertiary">良好なポテンシャル</div>
            </div>
          </div>

          {/* Bento grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Improvement list */}
            <div className="md:col-span-4 bg-white p-8 rounded-xl shadow-sm space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary">lightbulb</span>
                改善提案リスト
              </h3>
              <ul className="space-y-4">
                <li className="flex gap-3 items-start group">
                  <span className="material-symbols-outlined text-error mt-1 text-xl">
                    priority_high
                  </span>
                  <div>
                    <p className="font-bold text-on-surface">CTAボタンのコントラストを上げる</p>
                    <p className="font-body text-sm text-on-surface-variant">
                      現在の色は背景に馴染みすぎています。彩度の高い色を推奨。
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="material-symbols-outlined text-primary mt-1 text-xl">
                    tips_and_updates
                  </span>
                  <div>
                    <p className="font-bold text-on-surface">キャッチコピーをベネフィット訴求に</p>
                    <p className="font-body text-sm text-on-surface-variant">
                      「多機能」よりも「時間の短縮」にフォーカスした表現が効果的。
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="material-symbols-outlined text-primary mt-1 text-xl">
                    tips_and_updates
                  </span>
                  <div>
                    <p className="font-bold text-on-surface">人物の視線をテキストに誘導</p>
                    <p className="font-body text-sm text-on-surface-variant">
                      写真の人物の目線を主要なメッセージに向けることで読了率が向上。
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Before / After visual */}
            <div className="md:col-span-8 grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl shadow-sm relative group">
                <span className="absolute top-6 left-6 z-10 bg-on-surface/80 text-white px-3 py-1 rounded-full text-xs font-bold">
                  BEFORE
                </span>
                <img
                  className="w-full h-full object-cover rounded-lg aspect-video"
                  alt="Cluttered banner advertisement with low contrast text"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuA_7YQ4VBXSyXYoNhUc5pSS2XJ82FiAVkO-mTyFS_r7TDzEigjcZB6V6BA1fxaorEh9wLI2GKX6ZkBCtANGs3yxVxXV8wEwHv49h-sRSy-6R6qEESwO0G8vFHzo03EPgp0n-ycv3CSBoboMjkdWwpf7o6c1tqr_Kk6FGef7Ur7T3KUzELN_Fqn1kZayOClJCHadtylsosImZ9GrjrRuSnaCl3_r9d29MgyA7bUsE9F57mwgvhUBD6gQrvOhBp8GxEwPj3YrIFC_IRw"
                />
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm relative">
                <span className="absolute top-6 left-6 z-10 bg-primary text-white px-3 py-1 rounded-full text-xs font-bold">
                  AFTER (Suggested)
                </span>
                <img
                  className="w-full h-full object-cover rounded-lg aspect-video"
                  alt="Clean high-converting banner with bold typography and clear CTA"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDQcz3mCeObJH_NKqpBmtMC5p_1cRM1Q5XRV-wf1TJLCy1NFbC2FYKxkjPq9xR6jF6tKoikk26XWYoRD6JHPL2hwckdgVLV2IGCOhlNE3VndJdfzOqPjeOGyJ215uGBmuMKph_UIgOUvPtsmWzCYEDpkh3FPcqVPmju7GIb2blg4n6MP4Hh08_wxWBsmPEbIn8f54hYmLNw-K3fhD6Zpy3CIJj9v9OTme5vUPtJBdTI26Y0khTXcpUpbs02cwjs40tBJhJt8jLktcw"
                />
              </div>
              <div className="col-span-2 bg-white p-6 rounded-xl shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-bold">視線ヒートマップ解析</p>
                  <span className="font-body text-sm text-on-surface-variant">
                    予測モデル: Insight AI v4.2
                  </span>
                </div>
                <div className="h-48 w-full bg-gradient-to-r from-blue-100 via-yellow-100 to-red-100 rounded-lg flex items-center justify-center border border-outline-variant/20">
                  <p className="font-body text-sm text-on-surface-variant font-medium">
                    ヒートマップビジュアライゼーション生成中...
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Items Grid ── */}
      <LpSection className="py-24 max-w-7xl mx-auto px-8">
        <div className="text-center mb-16 space-y-4">
          <h2 className="font-headline text-4xl font-bold">診断できる項目一覧</h2>
          <p className="font-body text-on-surface-variant">
            あらゆるデジタルクリエイティブに対応しています。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            {
              icon: 'ad_units',
              title: 'バナー広告',
              desc: '静止画バナーのクリック率(CTR)を最大化するための構成を診断。',
            },
            {
              icon: 'web',
              title: 'LP全体',
              desc: 'ランディングページ全体のストーリー構成とCVR向上のための改善提案。',
            },
            {
              icon: 'smart_display',
              title: '動画サムネイル',
              desc: 'YouTubeやSNS動画のクリックを誘発する視覚的インパクトを診断。',
            },
            {
              icon: 'share',
              title: 'SNS広告',
              desc: 'タイムラインに馴染みつつ指を止める、SNS特有のクリエイティブ解析。',
            },
          ].map((item) => (
            <div
              key={item.icon}
              className="p-8 bg-surface-container-low rounded-2xl hover:shadow-md transition-shadow text-center"
            >
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                <span className="material-symbols-outlined text-primary text-3xl">
                  {item.icon}
                </span>
              </div>
              <h3 className="text-xl font-bold mb-3">{item.title}</h3>
              <p className="font-body text-sm text-on-surface-variant leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </LpSection>

      {/* ── CTA ── */}
      <LpCta
        heading={"あなたのクリエイティブの\n真の実力を今すぐ診断しましょう"}
        body="会員登録なしでも、最初の1枚は無料で診断可能です。"
        primaryLabel="あなたのクリエイティブを無料で診断する"
        secondaryLabel={null}
      />
    </>
  )
}
