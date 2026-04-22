import { useRef, useCallback, useEffect } from 'react'
import { classifyError } from '../api/marketLens'

const POLL_INTERVAL_INITIAL_MS = 2000
const POLL_INTERVAL_SLOW_MS = 5000
const POLL_SLOWDOWN_AFTER_MS = 30000
const POLL_MAX_NETWORK_ERRORS = 3

/**
 * Generic async job polling hook.
 * Handles polling loop, stale detection, hard ceiling, and error handling.
 *
 * Usage:
 *   const { pollJob, stopPolling } = useAsyncJob()
 *   pollJob(pollPath, { fetchJobStatus, onComplete, onFail, onProgress, ... })
 */
export function useAsyncJob() {
  const pollTimerRef = useRef(null)
  const pollErrorCountRef = useRef(0)
  const pollStartTimeRef = useRef(0)
  const pollStoppedRef = useRef(false)
  const lastUpdatedAtRef = useRef(null)
  const staleStartRef = useRef(null)

  // Imperative cleanup on unmount — avoids stale-closure issues
  useEffect(() => () => {
    pollStoppedRef.current = true
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
  }, [])

  const stopPolling = useCallback(() => {
    pollStoppedRef.current = true
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollErrorCountRef.current = 0
    lastUpdatedAtRef.current = null
    staleStartRef.current = null
  }, [])

  /**
   * Start polling a job at pollPath.
   *
   * @param {string} pollPath - relative path like /scan/jobs/{id}
   * @param {object} opts
   *   fetchJobStatus(pollPath) => Promise<{ status, stage, progress_pct, result, error, retry_after_sec, updated_at }>
   *   onComplete(result, data)  - called when job.status === 'completed'
   *   onFail(message, info)     - called on terminal failure
   *   onProgress({ stage, progress_pct, message, statusLabel }) - called each tick
   *   intervalMs               - initial poll interval (ms)
   *   hardCeilingMs            - max total polling time before forcing failure
   *   staleTimeoutMs           - max inactivity (no updated_at change) before failing
   *   softWarningMs            - elapsed threshold for "taking longer than expected" warning
   *   resetStartTime           - whether to reset the start-time clock (default: true)
   */
  const pollJob = useCallback(function pollJobCallback(pollPath, {
    fetchJobStatus,
    onComplete,
    onFail,
    onProgress,
    intervalMs = POLL_INTERVAL_INITIAL_MS,
    hardCeilingMs = 660_000,
    staleTimeoutMs = 90_000,
    softWarningMs = 300_000,
    resetStartTime = true,
  } = {}) {
    pollStoppedRef.current = false
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollErrorCountRef.current = 0
    lastUpdatedAtRef.current = null
    staleStartRef.current = null
    if (resetStartTime || !pollStartTimeRef.current) {
      pollStartTimeRef.current = Date.now()
    }

    async function tick() {
      if (pollStoppedRef.current) return

      const elapsed = Date.now() - pollStartTimeRef.current

      // Hard ceiling
      if (elapsed > hardCeilingMs) {
        stopPolling()
        onFail?.('分析がタイムアウトしました。再試行してください。', {
          category: 'timeout', label: 'タイムアウト', guidance: '再試行してください。', retryable: true,
        })
        return
      }

      // Soft warning
      if (elapsed > softWarningMs) {
        onProgress?.({ stage: null, progress_pct: null, statusLabel: '通常より時間がかかっていますが、サーバーは応答中です…' })
      }

      try {
        const data = await fetchJobStatus(pollPath)
        pollErrorCountRef.current = 0

        // Stale detection: if updated_at hasn't changed for staleTimeoutMs, fail
        if ((data.status === 'running' || data.status === 'queued') && data.updated_at) {
          const updatedAtStr = String(data.updated_at)
          if (updatedAtStr === lastUpdatedAtRef.current) {
            if (!staleStartRef.current) {
              staleStartRef.current = Date.now()
            } else if (Date.now() - staleStartRef.current > staleTimeoutMs) {
              stopPolling()
              onFail?.('サーバーが応答しなくなりました。再試行してください。', {
                category: 'stale', label: 'サーバー無応答', guidance: '再試行してください。', retryable: true,
              })
              return
            }
          } else {
            lastUpdatedAtRef.current = updatedAtStr
            staleStartRef.current = null
          }
        }

        // Progress update
        onProgress?.({
          stage: data.stage,
          progress_pct: data.progress_pct,
          message: data.message,
          statusLabel: null,
        })

        if (data.status === 'completed' && data.result) {
          stopPolling()
          onComplete?.(data.result, data)
          return
        }

        if (data.status === 'completed' && !data.result) {
          stopPolling()
          onFail?.('ジョブは完了しましたが、結果データがありません。再試行してください。', {
            category: 'upstream', label: '結果なし', guidance: '再試行してください。', retryable: true,
          })
          return
        }

        if (data.status === 'failed') {
          stopPolling()
          const detail = data.error?.detail || 'ジョブが失敗しました'
          const retryable = data.error?.retryable ?? true
          onFail?.(detail, { category: 'upstream', label: 'ジョブエラー', guidance: detail, retryable })
          return
        }

        // Schedule next poll with adaptive backoff
        const baseInterval = elapsed > POLL_SLOWDOWN_AFTER_MS ? POLL_INTERVAL_SLOW_MS : intervalMs
        const nextInterval = Number(data.retry_after_sec) > 0
          ? Number(data.retry_after_sec) * 1000
          : baseInterval
        pollTimerRef.current = setTimeout(tick, nextInterval)
      } catch (e) {
        pollErrorCountRef.current += 1
        if (pollErrorCountRef.current >= POLL_MAX_NETWORK_ERRORS) {
          stopPolling()
          const info = classifyError(e)
          onFail?.(e.message || 'ポーリング中にエラーが発生しました', info)
          return
        }
        const retryInterval = Date.now() - pollStartTimeRef.current > POLL_SLOWDOWN_AFTER_MS
          ? POLL_INTERVAL_SLOW_MS
          : intervalMs
        pollTimerRef.current = setTimeout(tick, retryInterval)
      }
    }

    pollTimerRef.current = setTimeout(tick, intervalMs)
  }, [stopPolling])

  return { pollJob, stopPolling, pollTimerRef, pollStoppedRef }
}
