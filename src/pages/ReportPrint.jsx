import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getProjectReport } from '../api/projectReports'
import CustomerReportDocument from '../components/reporting/CustomerReportDocument'
import useDocumentPrivacyMeta from '../hooks/useDocumentPrivacyMeta'
import { normalizeCustomerError } from '../utils/customerErrors'

export default function ReportPrint() {
  const { projectRef = '', reportId = '' } = useParams()
  const requestKey = `${projectRef}:${reportId}`
  const [state, setState] = useState({ requestKey: '', status: 'loading', report: null, error: null })
  useDocumentPrivacyMeta('印刷用Web成果レポート | Insight Studio')

  useEffect(() => {
    let active = true
    getProjectReport(projectRef, reportId)
      .then((response) => {
        if (!active) return
        if (!response?.report?.report) throw new Error('report_unavailable')
        setState({ requestKey, status: 'ready', report: response.report, error: null })
      })
      .catch((error) => {
        if (!active) return
        setState({
          requestKey,
          status: 'error',
          report: null,
          error: normalizeCustomerError(error),
        })
      })
    return () => { active = false }
  }, [projectRef, reportId, requestKey])

  const currentState = state.requestKey === requestKey
    ? state
    : { status: 'loading', report: null, error: null }

  return (
    <div className="report-print-page min-h-screen bg-surface px-4 py-5 sm:px-6 lg:py-8">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          .report-print-page { padding: 0 !important; background: #fff !important; }
          .report-print-toolbar { display: none !important; }
          .customer-report-document {
            max-width: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div className="report-print-toolbar mx-auto mb-5 flex max-w-[920px] flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <Link
          to="/ads/report"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_back</span>
          レポートへ戻る
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={currentState.status !== 'ready'}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-black text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">print</span>
          印刷・PDFとして保存
        </button>
      </div>

      <main>
        {currentState.status === 'loading' && (
          <section className="mx-auto max-w-[920px] rounded-2xl bg-white p-8 text-center shadow-sm" role="status" aria-live="polite">
            <span className="material-symbols-outlined animate-spin text-3xl text-primary motion-reduce:animate-none" aria-hidden="true">progress_activity</span>
            <h1 className="mt-4 text-xl font-extrabold text-primary japanese-text">印刷用レポートを準備しています</h1>
          </section>
        )}
        {currentState.status === 'error' && (
          <section className="mx-auto max-w-[920px] rounded-2xl bg-white p-8 text-center shadow-sm" role="alert">
            <h1 className="text-xl font-extrabold text-primary japanese-text">{currentState.error.title}</h1>
            <p className="mt-3 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">{currentState.error.body}</p>
          </section>
        )}
        {currentState.status === 'ready' && (
          <CustomerReportDocument
            report={currentState.report.report}
            title={currentState.report.title || 'Web成果レポート'}
            summary={currentState.report.summary || ''}
          />
        )}
      </main>
    </div>
  )
}
