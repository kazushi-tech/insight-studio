import { Link } from 'react-router-dom'
import LpSection from './components/LpSection'
import LpCta from './components/LpCta'
import LpImage from './components/LpImage'
import { demoPreviewUrl, salesContactUrl } from './salesContact'

const problems = [
  {
    icon: 'query_stats',
    title: 'GA4を開いても迷う',
    body: '項目が多く、最初に見る数字と次の確認先が分からない。',
  },
  {
    icon: 'schedule',
    title: 'レポート作成に時間がかかる',
    body: '集計や転記に時間を使い、改善策を考える時間が減ってしまう。',
  },
  {
    icon: 'warning',
    title: 'データ不足に気づけない',
    body: '取得できていない数字まで、正しい結果だと思って判断してしまう。',
  },
  {
    icon: 'hub',
    title: '分析が次の施策につながらない',
    body: 'グラフを見ても、誰が何を確認するかまで決められない。',
  },
]

const features = [
  {
    title: 'GA4・BigQueryかんたんレポート',
    body: 'アクセス、来訪元、ページ、成果を、専門用語を減らした順番で確認できます。',
    to: '/lp/performance',
    colSpan: 'md:col-span-8',
    rowSpan: 'md:row-span-2',
    hasImage: true,
  },
  {
    title: '根拠が見えるグラフ',
    body: '期間、指標、取得状態を一緒に表示し、判断できない項目を未取得として残します。',
    to: '/lp/performance',
    colSpan: 'md:col-span-4',
    rowSpan: '',
  },
  {
    title: 'キーなしの自動整理',
    body: '基本レポートと根拠整理は、GeminiやClaudeのAPIキーなしで始められます。',
    to: '/lp/performance',
    colSpan: 'md:col-span-4',
    rowSpan: '',
  },
  {
    title: '競合・LP分析',
    body: '必要なときだけAIキーを設定し、自社と競合の訴求、CTA、信頼要素を比較します。',
    to: '/lp/compare',
    colSpan: 'md:col-span-6',
    rowSpan: '',
  },
  {
    title: 'クリエイティブ診断',
    body: '広告画像とLPの訴求を確認し、次に試す改善仮説を整理します。',
    to: '/lp/creative',
    colSpan: 'md:col-span-6',
    rowSpan: '',
    isPrimary: true,
  },
]

const differentiators = [
  {
    num: '01',
    title: 'AIキーなしから始められる',
    body: 'まずはグラフと決められたルールによる根拠整理を使い、必要な分析だけAIへ広げます。',
  },
  {
    num: '02',
    title: 'ないデータを断定しない',
    body: '取得済み、一部取得、未取得を分け、データ不足と悪い結果を混同しないように表示します。',
  },
  {
    num: '03',
    title: '課題発見から追加分析へ進める',
    body: 'サイト分析で課題を見つけたあと、競合・LP・クリエイティブ分析へ必要な範囲だけ進めます。',
  },
]

const previewPoints = [
  {
    icon: 'summarize',
    title: '最初に結論を確認',
    body: '変化、判断を保留する項目、次に確認することを先に表示します。',
  },
  {
    icon: 'monitoring',
    title: '根拠をグラフで確認',
    body: '対象期間と取得状態をセットで表示し、数字だけを切り離しません。',
  },
  {
    icon: 'task_alt',
    title: '次の確認先を決める',
    body: '担当者が次に開くページや計測設定まで、確認順に整理します。',
  },
]

const onboardingSteps = [
  {
    title: '画面サンプルを確認',
    body: 'レポートの見え方と、AIキーが必要な機能・不要な機能を確認します。',
  },
  {
    title: '接続条件を相談',
    body: 'GA4・BigQueryの取得状況、対象サイト、必要な支援範囲を整理します。',
  },
  {
    title: '初回レポートを確認',
    body: '接続後の結果を見ながら、継続して見る項目と運用手順を決めます。',
  },
]

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ── */}
      <LpSection animate={false} className="relative overflow-hidden pt-32 pb-24 px-6">
        {/* Background blurs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-tertiary/6 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/4" />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
          <div className="text-center lg:text-left">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-primary-fixed/20 border border-primary/15 rounded-full px-5 py-2 mb-8">
              <span className="material-symbols-outlined text-primary text-base">auto_awesome</span>
              <span className="text-sm font-bold tracking-widest text-primary font-label">はじめてのWebサイト分析</span>
            </div>

            {/* Headline */}
            <h1 className="mb-8 font-headline text-4xl font-extrabold leading-tight text-on-surface md:text-5xl lg:text-6xl">
              サイトの数字を、
              <br />
              <span className="text-primary">次の行動へ。</span>
            </h1>

            <p className="mx-auto mb-10 max-w-2xl font-body text-lg leading-relaxed text-on-surface-variant md:text-xl lg:mx-0">
              GA4とBigQueryのデータを、初心者にも読めるレポートとグラフへ。
              <br className="hidden md:block" />
              基本分析はAIキーなし。必要なときだけ競合・LP・画像分析を追加できます。
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
              <Link
                to={demoPreviewUrl}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-10 py-5 text-lg font-extrabold text-white shadow-xl shadow-primary/25 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                画面サンプルを見る
                <span className="material-symbols-outlined text-xl" aria-hidden="true">arrow_forward</span>
              </Link>
              <Link
                to="/lp/pricing"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-white/80 px-10 py-5 text-lg font-extrabold text-primary transition-colors hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                料金と導入条件を見る
                <span className="material-symbols-outlined text-xl" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>
          </div>

          {/* Dashboard mockup glass card */}
          <div className="relative mx-auto w-full max-w-2xl">
            <div className="glass-card rounded-3xl p-3 shadow-2xl">
              <LpImage icon="monitoring"
                src="/imagegen/beginner-analytics-collaboration.webp"
                alt="Webサイトの数字を一緒に確認する担当者"
                width="1536"
                height="1024"
                fetchPriority="high"
                className="aspect-[3/2] w-full rounded-2xl object-cover"
              />
            </div>
            {/* Capability badge */}
            <div className="absolute -bottom-4 -right-4 md:-bottom-6 md:-right-6 bg-white rounded-2xl shadow-xl p-4 md:p-5 border border-primary/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary-fixed/40 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-xl md:text-2xl" aria-hidden="true">key_off</span>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant font-medium">基本分析</p>
                  <p className="text-base md:text-lg font-extrabold text-primary">AIキー不要</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Product proof ── */}
      <LpSection id="product-preview" className="scroll-mt-24 bg-[#f2f0e7] px-6 py-20 md:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-14">
          <div>
            <p className="mb-4 text-sm font-bold tracking-widest text-primary font-label">画面サンプル</p>
            <h2 className="text-pretty font-headline text-3xl font-extrabold leading-tight text-on-surface md:text-5xl">
              開いたら、見る順番が分かります。
            </h2>
            <p className="mt-6 max-w-xl text-base leading-8 text-on-surface-variant md:text-lg">
              管理画面の項目を並べるのではなく、結論、根拠、次の確認先の順で案内します。
              専門用語を知っている方は、括弧内の項目名から同じ指標を確認できます。
            </p>
            <ul className="mt-8 space-y-5">
              {previewPoints.map((point) => (
                <li key={point.title} className="flex gap-4">
                  <span className="material-symbols-outlined grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-primary/10" aria-hidden="true">
                    {point.icon}
                  </span>
                  <div>
                    <h3 className="font-bold text-on-surface">{point.title}</h3>
                    <p className="mt-1 text-sm leading-7 text-on-surface-variant">{point.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <figure className="overflow-hidden rounded-[2rem] bg-white shadow-[0_24px_70px_rgba(0,57,37,0.13)] ring-1 ring-primary/10" aria-label="Webサイト成果レポートの画面サンプル">
            <div className="flex items-center justify-between border-b border-outline-variant/35 bg-[#fbfbf7] px-5 py-4 sm:px-7">
              <div>
                <p className="text-xs font-bold text-primary">WEBサイト成果レポート</p>
                <p className="mt-1 text-sm font-bold text-on-surface">見る期間と取得状態を一緒に表示</p>
              </div>
              <span className="rounded-full bg-primary-fixed/30 px-3 py-1 text-xs font-bold text-primary">サンプル</span>
            </div>
            <div className="grid gap-4 p-5 sm:p-7 md:grid-cols-[minmax(0,1.2fr)_minmax(14rem,0.8fr)]">
              <section className="rounded-2xl bg-primary p-5 text-white sm:p-6" aria-labelledby="preview-summary-title">
                <p className="text-xs font-bold text-primary-fixed-dim">今回のまとめ</p>
                <h3 id="preview-summary-title" className="mt-2 text-xl font-extrabold">先に読むポイントを3つに整理</h3>
                <div className="mt-5 grid gap-3">
                  {['確認できた変化', 'まだ判断できない項目', '次に確認すること'].map((label, index) => (
                    <div key={label} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-fixed-dim text-xs font-black text-on-primary-fixed">{index + 1}</span>
                      <span className="text-sm font-bold">{label}</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="grid gap-4">
                <section className="rounded-2xl bg-surface-container-low p-5">
                  <p className="text-xs font-bold text-primary">根拠を見る</p>
                  <h3 className="mt-2 font-bold text-on-surface">期間・来訪元・成果</h3>
                  <div className="mt-5 space-y-3" aria-hidden="true">
                    <div className="h-2 w-full rounded-full bg-primary/12"><div className="h-2 w-4/5 rounded-full bg-primary/55" /></div>
                    <div className="h-2 w-full rounded-full bg-primary/12"><div className="h-2 w-3/5 rounded-full bg-tertiary-container" /></div>
                    <div className="h-2 w-full rounded-full bg-primary/12"><div className="h-2 w-2/5 rounded-full bg-primary/30" /></div>
                  </div>
                </section>
                <section className="rounded-2xl border border-outline-variant/45 bg-white p-5">
                  <p className="text-xs font-bold text-primary">取得できない場合</p>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">推測で埋めず、接続・計測を確認する項目として残します。</p>
                </section>
              </div>
            </div>
            <figcaption className="border-t border-outline-variant/35 px-5 py-4 text-xs leading-6 text-on-surface-variant sm:px-7">
              画面構成のサンプルです。実際の数値は、対象サイトの接続後に表示されます。
            </figcaption>
          </figure>
        </div>
      </LpSection>

      {/* ── Problem Section ── */}
      <LpSection className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">よくあるつまずき</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-on-surface leading-tight">
              サイト分析で止まりやすい
              <br className="hidden md:block" />
              4つのポイント
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {problems.map((p, i) => (
              <div
                key={i}
                className="rounded-3xl border border-outline-variant/60 bg-white p-8 shadow-sm transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-lg"
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
            <p className="text-sm font-bold tracking-widest text-primary mb-4 font-label">できること</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-on-surface leading-tight">
              必要な順番で使える分析機能
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-auto">
            {features.map((f, i) => (
              <Link
                key={i}
                to={f.to}
                className={`group rounded-3xl p-8 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-xl ${f.colSpan} ${f.rowSpan} ${
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
                      <LpImage icon="monitoring"
                        src="/imagegen/calm-analytics-desk.webp"
                        alt="Webサイト分析レポート画面"
                        width="1536"
                        height="1024"
                        loading="lazy"
                        className="aspect-[3/2] w-full rounded-2xl object-cover transition-transform group-hover:scale-[1.01]"
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
            <p className="text-sm font-bold tracking-widest text-tertiary-fixed-dim mb-4 font-label">判断しやすくする工夫</p>
            <h2 className="font-headline text-3xl md:text-5xl font-extrabold text-white leading-tight">
              迷わず判断するための
              <br className="hidden md:block" />
              3つの設計
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
              <LpImage icon="monitoring"
                src="/imagegen/data-to-action-paper-collage.webp"
                alt="データを整理して次の行動へ進む流れ"
                width="1536"
                height="1024"
                loading="lazy"
                className="aspect-[3/2] w-full object-cover"
              />
            </div>
          </div>
        </div>
      </LpSection>

      {/* ── Onboarding ── */}
      <LpSection id="onboarding" className="scroll-mt-24 px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-4 text-sm font-bold tracking-widest text-primary font-label">先行導入の流れ</p>
            <h2 className="text-pretty font-headline text-3xl font-extrabold leading-tight text-on-surface md:text-5xl">
              分からない設定を、最初から任せられます。
            </h2>
            <p className="mt-5 text-base leading-8 text-on-surface-variant md:text-lg">
              現在は1社ずつ接続条件を確認する先行導入です。自社だけで設定を完了させる必要はありません。
            </p>
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            {onboardingSteps.map((step, index) => (
              <li key={step.title} className="rounded-3xl border border-outline-variant/50 bg-white p-7 shadow-sm">
                <span className="grid size-10 place-items-center rounded-full bg-tertiary-container text-sm font-black text-on-tertiary-container">{index + 1}</span>
                <h3 className="mt-5 text-lg font-bold text-on-surface">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-on-surface-variant">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-col items-start justify-between gap-5 rounded-3xl bg-surface-container-low p-6 sm:flex-row sm:items-center md:p-8">
            <div>
              <p className="font-bold text-on-surface">相談時点で、料金やAIキーを決め切る必要はありません。</p>
              <p className="mt-2 text-sm leading-7 text-on-surface-variant">対象サイト、現在の接続状況、見たい成果を確認してから書面でご案内します。</p>
            </div>
            <a href={salesContactUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-bold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              導入条件を相談する
              <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            </a>
          </div>
        </div>
      </LpSection>

      {/* ── CTA ── */}
      <LpCta
        heading={'まずは画面を見て、\n自社データの接続条件を確認。'}
        body="基本レポートとグラフはAIキーなしで確認できます。実データ利用にはGA4・BigQueryの接続が必要です。"
        primaryLabel="画面サンプルを見る"
        primaryTo={demoPreviewUrl}
        secondaryLabel="導入条件を相談する"
        secondaryTo={salesContactUrl}
      />
    </>
  )
}
