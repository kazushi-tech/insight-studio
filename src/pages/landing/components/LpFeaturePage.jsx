import { Link } from 'react-router-dom'
import LpCta from './LpCta'
import LpImage from './LpImage'
import LpSection from './LpSection'
import { demoPreviewUrl } from '../salesContact'

export default function LpFeaturePage({
  eyebrow,
  icon,
  title,
  highlight,
  description,
  image,
  imageAlt,
  primaryLabel,
  primaryTo,
  cards,
  steps,
  noteTitle,
  note,
}) {
  return (
    <>
      <LpSection animate={false} id="demo" className="relative overflow-hidden px-6 pb-20 pt-24 sm:pt-28">
        <div className="absolute right-0 top-0 size-[34rem] -translate-y-1/3 translate-x-1/4 rounded-full bg-primary/8 blur-[120px]" />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="text-center lg:text-left">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary-fixed/20 px-5 py-2">
              <span className="material-symbols-outlined text-base text-primary" aria-hidden="true">{icon}</span>
              <span className="font-label text-sm font-bold tracking-widest text-primary">{eyebrow}</span>
            </div>
            <h1 className="mb-7 text-pretty font-headline text-4xl font-extrabold leading-tight text-on-surface md:text-5xl">
              {title}<br /><span className="text-primary">{highlight}</span>
            </h1>
            <p className="mx-auto mb-9 max-w-xl text-lg leading-8 text-on-surface-variant lg:mx-0">{description}</p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Link to={primaryTo} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-8 py-4 font-bold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                {primaryLabel}
                <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </Link>
              <Link to="/lp/pricing" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-white px-8 py-4 font-bold text-primary transition-colors hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                導入条件を見る
              </Link>
            </div>
          </div>
          <div className="rounded-3xl bg-white p-3 shadow-2xl ring-1 ring-primary/10">
            <LpImage
              src={image}
              alt={imageAlt}
              width="1536"
              height="1024"
              fetchPriority="high"
              className="aspect-[3/2] w-full rounded-2xl object-cover"
            />
          </div>
        </div>
      </LpSection>

      <LpSection className="bg-surface-container-low px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-bold tracking-widest text-primary">確認できること</p>
            <h2 className="text-pretty font-headline text-3xl font-extrabold text-on-surface md:text-4xl">この機能で確認できること</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {cards.map((card) => (
              <article key={card.title} className="rounded-3xl bg-white p-7 ring-1 ring-outline-variant/40">
                <span className="material-symbols-outlined mb-5 grid size-12 place-items-center rounded-2xl bg-primary/8 text-primary" aria-hidden="true">{card.icon}</span>
                <h3 className="mb-3 text-lg font-bold text-on-surface">{card.title}</h3>
                <p className="text-sm leading-7 text-on-surface-variant">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </LpSection>

      <LpSection className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-bold tracking-widest text-primary">進め方</p>
            <h2 className="font-headline text-3xl font-extrabold text-on-surface md:text-4xl">3ステップで進めます</h2>
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-3xl border border-outline-variant/50 bg-white p-7">
                <span className="mb-5 grid size-10 place-items-center rounded-full bg-primary font-black text-on-primary">{index + 1}</span>
                <h3 className="mb-2 text-lg font-bold text-on-surface">{step.title}</h3>
                <p className="text-sm leading-7 text-on-surface-variant">{step.body}</p>
              </li>
            ))}
          </ol>
          <aside className="mt-8 rounded-2xl border border-secondary/20 bg-secondary/5 p-5" aria-label={noteTitle}>
            <p className="font-bold text-on-surface">{noteTitle}</p>
            <p className="mt-2 text-sm leading-7 text-on-surface-variant">{note}</p>
          </aside>
        </div>
      </LpSection>

      <LpCta
        heading={'まずはデモで、\n画面と利用条件を確認。'}
        body="実データやAIキーが必要な範囲を確認してから、導入内容を決められます。"
        primaryLabel="画面サンプルを見る"
        primaryTo={demoPreviewUrl}
        secondaryLabel="料金と導入条件を見る"
        secondaryTo="/lp/pricing"
      />
    </>
  )
}
