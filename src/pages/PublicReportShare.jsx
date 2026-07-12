import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicReportShare } from '../api/projectReports'
import CustomerReportDocument from '../components/reporting/CustomerReportDocument'
import useDocumentPrivacyMeta from '../hooks/useDocumentPrivacyMeta'

function LoadingState() {
  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm" role="status" aria-live="polite">
      <span className="material-symbols-outlined animate-spin text-3xl text-primary motion-reduce:animate-none" aria-hidden="true">progress_activity</span>
      <h1 className="mt-4 text-xl font-extrabold text-primary japanese-text">共有レポートを確認しています</h1>
      <p className="mt-2 text-sm font-semibold text-on-surface-variant japanese-text">安全な閲覧リンクかを確認しています。</p>
    </section>
  )
}

function ErrorState({ status }) {
  const expired = status === 404 || status === 410
  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm" role="alert">
      <span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">{expired ? 'link_off' : 'error'}</span>
      <h1 className="mt-4 text-xl font-extrabold text-primary japanese-text">
        {expired ? 'この共有リンクは利用できません' : '共有レポートを表示できませんでした'}
      </h1>
      <p className="mt-3 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
        {expired
          ? '閲覧期限が切れたか、発行元によって失効されています。新しいリンクを発行元へご依頼ください。'
          : '少し時間をおいてもう一度開いてください。解消しない場合は発行元へお問い合わせください。'}
      </p>
    </section>
  )
}

export default function PublicReportShare() {
  const { token = '' } = useParams()
  const [state, setState] = useState({ token: '', status: 'loading', share: null, errorStatus: null })
  useDocumentPrivacyMeta('共有レポート | Insight Studio')

  useEffect(() => {
    let active = true
    fetchPublicReportShare(token)
      .then((response) => {
        if (!active) return
        const share = response?.share
        if (!share?.report) throw new Error('shared_report_unavailable')
        setState({ token, status: 'ready', share, errorStatus: null })
      })
      .catch((error) => {
        if (!active) return
        setState({ token, status: 'error', share: null, errorStatus: Number(error?.status) || null })
      })
    return () => { active = false }
  }, [token])

  const currentState = state.token === token
    ? state
    : { status: 'loading', share: null, errorStatus: null }

  return (
    <main className="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:py-12">
      {currentState.status === 'loading' && <LoadingState />}
      {currentState.status === 'error' && <ErrorState status={currentState.errorStatus} />}
      {currentState.status === 'ready' && (
        <CustomerReportDocument
          report={currentState.share.report}
          title={currentState.share.title || 'Web成果レポート'}
          summary={currentState.share.summary || ''}
          expiresAt={currentState.share.expires_at}
        />
      )}
    </main>
  )
}
