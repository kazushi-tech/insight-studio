import { useEffect, useRef, useState } from 'react'
import { getScanReportEnvelope, getDiscoveryReportEnvelope } from '../api/marketLens'

/**
 * Fetches the ReportEnvelope v0 side-channel for a scan or discovery job.
 *
 * Behavior:
 * - When the backend flag `REPORT_ENVELOPE_V0` is off, the endpoint returns 404.
 *   We treat that as a silent miss (envelope: null) so callers can fall back to
 *   the existing MD parsing path without any user-visible error.
 * - Other errors are surfaced via `error` so UI can decide to show a warning.
 *
 * @param {'scan' | 'discovery' | null} kind
 * @param {string | null | undefined} id
 * @returns {{ envelope: object | null, loading: boolean, error: Error | null }}
 */
export function useReportEnvelope(kind, id) {
  const [envelope, setEnvelope] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    if (!kind || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when params clear
      setEnvelope(null)
      setLoading(false)
      setError(null)
      return () => {
        cancelRef.current = true
      }
    }

    setLoading(true)
    setError(null)

    const fetcher = kind === 'discovery' ? getDiscoveryReportEnvelope : getScanReportEnvelope

    fetcher(id)
      .then((data) => {
        if (cancelRef.current) return
        setEnvelope(data ?? null)
      })
      .catch((err) => {
        if (cancelRef.current) return
        const status = Number(err?.status || 0)
        if (status === 404 || status === 409) {
          // Flag off or job not ready — silent fallback to MD path.
          setEnvelope(null)
          setError(null)
        } else {
          setEnvelope(null)
          setError(err)
        }
      })
      .finally(() => {
        if (cancelRef.current) return
        setLoading(false)
      })

    return () => {
      cancelRef.current = true
    }
  }, [kind, id])

  return { envelope, loading, error }
}
