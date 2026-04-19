import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReportViewV2 from '../../components/report/v2/ReportViewV2'
import { useReportEnvelope } from '../../hooks/useReportEnvelope'
import { getDiscoveryJob } from '../../api/marketLens'

export default function ReportV2Debug() {
  const [params] = useSearchParams()
  const jobId = params.get('jobId')
  const forceNullEnvelope = params.get('envelope') === 'null'
  const [job, setJob] = useState(null)
  const [jobError, setJobError] = useState(null)
  const { envelope, loading: envLoading } = useReportEnvelope(
    jobId && !forceNullEnvelope ? 'discovery' : null,
    jobId && !forceNullEnvelope ? jobId : null,
  )

  useEffect(() => {
    if (!jobId) return undefined
    let cancelled = false
    getDiscoveryJob(jobId)
      .then((data) => {
        if (!cancelled) setJob(data)
      })
      .catch((err) => {
        if (!cancelled) setJobError(err)
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (!jobId) {
    return <div data-testid="debug-error">jobId query param required</div>
  }
  if (jobError) {
    return <div data-testid="debug-error">job fetch error: {String(jobError?.message || jobError)}</div>
  }
  if (!job) {
    return <div data-testid="debug-loading">loading job...</div>
  }
  if (envLoading) {
    return <div data-testid="debug-loading">loading envelope...</div>
  }

  const reportMd = job?.result?.report_md ?? null
  const effectiveEnvelope = forceNullEnvelope ? null : envelope

  return <ReportViewV2 envelope={effectiveEnvelope} reportMd={reportMd} />
}
