import { useMemo } from 'react'
import { buildCustomerReportViewModel, getCustomerReportGaps } from '../../utils/customerReport'
import { sanitizeSharedReportText } from '../../utils/reportSharing'

const PRIORITY_LABELS = {
  P1: '最優先',
  P2: '次に対応',
  P3: '継続確認',
}

function formatDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '確認中'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

function formatNumber(value) {
  if (value == null || value === '') return '確認中'
  const number = Number(value)
  if (!Number.isFinite(number)) return sanitizeSharedReportText(value, '確認中')
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(number)
}

function metricValue(metric) {
  if (!['measured', 'measured_zero'].includes(metric?.current?.state)) return '確認中'
  const value = formatNumber(metric.current.value)
  const unit = sanitizeSharedReportText(metric.unit)
  return unit ? `${value} ${unit}` : value
}

function metricChange(metric) {
  if (metric?.change?.state === 'baseline_zero') return '前の期間が0のため、比較率は算出できません'
  const percent = Number(metric?.change?.percent)
  if (!Number.isFinite(percent)) return '前の期間との比較は確認中です'
  return `前の期間より ${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`
}

function EmptySection({ children }) {
  return (
    <p className="rounded-xl bg-surface-container-low px-4 py-3 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
      {children}
    </p>
  )
}

export default function CustomerReportDocument({
  report,
  title = 'Web成果レポート',
  summary = '',
  expiresAt = null,
}) {
  const view = useMemo(() => buildCustomerReportViewModel(report), [report])
  const gaps = useMemo(() => getCustomerReportGaps(view), [view])
  const safeTitle = sanitizeSharedReportText(title, 'Web成果レポート')
  const safeSummary = sanitizeSharedReportText(summary)

  if (!view) {
    return (
      <article className="mx-auto w-full max-w-[920px] rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-extrabold text-primary japanese-text">{safeTitle}</h1>
        <p className="mt-4 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
          このレポートは安全に表示できません。発行元へお問い合わせください。
        </p>
      </article>
    )
  }

  return (
    <article className="customer-report-document mx-auto w-full max-w-[920px] space-y-7 rounded-2xl bg-white p-5 text-on-surface shadow-sm sm:p-8 lg:p-10">
      <header className="space-y-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-secondary">Insight Studio</p>
          <h1 className="mt-2 break-words text-2xl font-extrabold tracking-tight text-primary japanese-text sm:text-3xl">
            {safeTitle}
          </h1>
          {safeSummary && (
            <p className="mt-3 max-w-3xl break-words text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
              {safeSummary}
            </p>
          )}
        </div>
        <dl className="grid gap-3 rounded-2xl bg-surface-container-low p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-bold text-on-surface-variant">対象</dt>
            <dd className="mt-1 break-words font-extrabold japanese-text">
              {sanitizeSharedReportText(view.scope?.site_name, '対象サイト')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-on-surface-variant">期間</dt>
            <dd className="mt-1 break-words font-extrabold japanese-text">
              {sanitizeSharedReportText(view.scope?.period_label ?? view.scope?.period, '表示中の期間')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-on-surface-variant">データ最終確認</dt>
            <dd className="mt-1 font-extrabold japanese-text">{formatDate(view.generated_at)}</dd>
          </div>
        </dl>
        {expiresAt && (
          <p className="text-xs font-bold text-on-surface-variant japanese-text">
            この共有ページの閲覧期限: {formatDate(expiresAt)}
          </p>
        )}
      </header>

      {view.metrics.length > 0 && (
        <section aria-labelledby="shared-report-metrics">
          <h2 id="shared-report-metrics" className="text-lg font-extrabold text-primary japanese-text">まず見る数字</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.metrics.slice(0, 6).map((metric) => (
              <article key={metric.key} className="break-inside-avoid rounded-2xl bg-surface-container-low p-4">
                <h3 className="text-xs font-bold text-on-surface-variant japanese-text">
                  {sanitizeSharedReportText(metric.label, '見るべき数字')}
                </h3>
                <p className="mt-2 text-xl font-extrabold tabular-nums text-primary">{metricValue(metric)}</p>
                <p className="mt-1 text-xs font-semibold text-on-surface-variant japanese-text">{metricChange(metric)}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="shared-report-conclusions">
        <h2 id="shared-report-conclusions" className="text-lg font-extrabold text-primary japanese-text">今回の結論</h2>
        {view.conclusions.length > 0 ? (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {view.conclusions.slice(0, 3).map((item, index) => (
              <article key={item.key} className="break-inside-avoid rounded-2xl bg-primary/[0.055] p-4">
                <p className="text-[11px] font-black text-secondary">結論 {index + 1}</p>
                <h3 className="mt-2 text-base font-extrabold leading-7 japanese-text">
                  {sanitizeSharedReportText(item.title, '判断を確認中です')}
                </h3>
                {item.body && (
                  <p className="mt-2 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
                    {sanitizeSharedReportText(item.body)}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3"><EmptySection>このデータだけでは、結論を出せません。</EmptySection></div>
        )}
      </section>

      <section className="break-inside-avoid rounded-2xl bg-primary p-5 text-on-primary" aria-labelledby="shared-report-actions">
        <h2 id="shared-report-actions" className="text-lg font-extrabold japanese-text">次にやること</h2>
        {view.actions.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {view.actions.slice(0, 3).map((action, index) => (
              <li key={action.key ?? `${action.priority}-${index}`} className="rounded-xl bg-white/10 p-4">
                <p className="text-xs font-black text-white/75">
                  {PRIORITY_LABELS[action.priority] ?? `優先 ${index + 1}`}
                </p>
                <h3 className="mt-1 text-sm font-extrabold leading-6 japanese-text">
                  {sanitizeSharedReportText(action.title, '次の確認事項')}
                </h3>
                {action.reason && (
                  <p className="mt-1 text-xs font-semibold leading-6 text-white/80 japanese-text">
                    {sanitizeSharedReportText(action.reason)}
                  </p>
                )}
                {action.success_metric && (
                  <p className="mt-2 text-xs font-bold text-white/75 japanese-text">
                    確認する数字: {sanitizeSharedReportText(action.success_metric)}
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-xl bg-white/10 p-4 text-sm font-semibold japanese-text">
            根拠を確認できるまで、行動の提案を保留します。
          </p>
        )}
      </section>

      <section aria-labelledby="shared-report-holds">
        <h2 id="shared-report-holds" className="text-lg font-extrabold text-primary japanese-text">まだ判断できないこと</h2>
        {gaps.length > 0 ? (
          <div className="mt-3 space-y-3">
            {gaps.map((gap) => (
              <article key={gap.key} className="break-inside-avoid rounded-2xl bg-warning-container/70 p-4">
                <h3 className="text-sm font-extrabold japanese-text">
                  {sanitizeSharedReportText(gap.title, '判断を保留しています')}
                </h3>
                {gap.body && (
                  <p className="mt-1 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
                    {sanitizeSharedReportText(gap.body)}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3"><EmptySection>追加で判断を保留している項目はありません。</EmptySection></div>
        )}
      </section>

      <section aria-labelledby="shared-report-evidence">
        <h2 id="shared-report-evidence" className="text-lg font-extrabold text-primary japanese-text">数字の根拠</h2>
        {view.evidence.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {view.evidence.map((item, index) => (
              <li key={item.key} className="break-inside-avoid rounded-xl bg-surface-container-low px-4 py-3 text-sm font-bold japanese-text">
                {index + 1}. {sanitizeSharedReportText(item.title, `根拠 ${index + 1}`)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3"><EmptySection>表示できる根拠を確認中です。</EmptySection></div>
        )}
      </section>

      <div role="note" className="pt-2 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
        このレポートは、確認できたサイト内の行動を整理したものです。費用対効果や施策との因果関係を断定するものではありません。
      </div>
    </article>
  )
}
