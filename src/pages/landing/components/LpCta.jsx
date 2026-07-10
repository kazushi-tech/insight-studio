import { Link } from 'react-router-dom'
import LpSection from './LpSection'
import { demoPreviewUrl, isExternalSalesUrl, salesContactUrl } from '../salesContact'

function ActionLink({ to, className, children }) {
  if (isExternalSalesUrl(to)) {
    return <a href={to} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
  }
  return <Link to={to} className={className}>{children}</Link>
}

export default function LpCta({
  heading = 'サイトの数字を、\n次の改善へ。',
  body = 'まずは画面と接続条件を確認し、必要な分析だけを選べます。',
  primaryLabel = '画面サンプルを見る',
  primaryTo = demoPreviewUrl,
  secondaryLabel = '導入条件を相談する',
  secondaryTo = salesContactUrl,
  variant = 'light',
}) {
  const isDark = variant === 'dark'

  return (
    <LpSection className={`py-24 px-6 ${isDark ? '' : 'relative overflow-hidden'}`}>
      <div
        className={`max-w-5xl mx-auto ${
          isDark
            ? 'bg-gradient-to-r from-[#003d2a] to-primary rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden shadow-2xl'
            : 'bg-primary-fixed/10 rounded-[2.5rem] p-12 md:p-20 text-center relative z-10 border border-primary-fixed/30'
        }`}
      >
        {isDark && (
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
              backgroundSize: '32px 32px',
            }}
          />
        )}
        <h2
          className={`text-3xl md:text-5xl font-extrabold mb-8 leading-tight relative z-10 whitespace-pre-line ${
            isDark ? 'text-white' : 'text-on-surface'
          }`}
        >
          {heading}
        </h2>
        {body && (
          <p
            className={`text-lg mb-12 max-w-xl mx-auto relative z-10 ${
              isDark ? 'text-white/80' : 'text-on-surface-variant'
            }`}
          >
            {body}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
          <ActionLink
            to={primaryTo}
            className={`min-h-11 rounded-2xl px-10 py-5 text-xl font-extrabold shadow-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 ${
              isDark
                ? 'bg-primary-fixed-dim text-on-primary-fixed'
                : 'bg-primary text-white shadow-primary/30'
            }`}
          >
            {primaryLabel}
          </ActionLink>
          {secondaryLabel && (
            <ActionLink
              to={secondaryTo}
              className={`min-h-11 rounded-2xl px-10 py-5 text-xl font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 ${
                isDark
                  ? 'bg-transparent border-2 border-primary-fixed-dim/50 text-primary-fixed hover:bg-white/5'
                  : 'bg-white text-primary border border-primary-fixed/40 hover:bg-primary-fixed/10'
              }`}
            >
              {secondaryLabel}
            </ActionLink>
          )}
        </div>
        {!isDark && (
          <p className="mt-8 text-sm text-on-surface-variant font-medium relative z-10">
            基本分析はAIキー不要 ・ 実データ利用にはGA4／BigQuery接続が必要
          </p>
        )}
        {isDark && (
          <p className="mt-8 text-white/60 font-medium relative z-10">
            現在は先行導入として、接続条件と運用範囲を確認してご案内します。
          </p>
        )}
      </div>
      {!isDark && (
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      )}
    </LpSection>
  )
}
