const ALLOWED_FIELDS = new Set([
  'request_id',
  'deployment_sha',
  'workspace_hash',
  'job_id',
  'stage',
  'duration_ms',
  'error_code',
  'metric',
  'value',
])

let sentryCaptureMessage = null

function safeValue(value) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value).slice(0, 160)
}

export function clientEvent(level, event, fields = {}) {
  const payload = {
    level: ['info', 'warning', 'error'].includes(level) ? level : 'info',
    event: String(event || 'event').slice(0, 80),
    service: 'frontend',
  }
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key) && value != null) payload[key] = safeValue(value)
  }
  const deploymentSha = import.meta.env.VITE_GIT_COMMIT_SHA
  if (!payload.deployment_sha && deploymentSha) payload.deployment_sha = String(deploymentSha).slice(0, 64)
  return payload
}

export function reportClientEvent(level, event, fields = {}) {
  const payload = clientEvent(level, event, fields)
  const method = level === 'error' ? console.error : level === 'warning' ? console.warn : console.info
  method(JSON.stringify(payload))
}

export async function initializeClientObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (dsn) {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_GIT_COMMIT_SHA || undefined,
      sendDefaultPii: false,
      beforeSend(event) {
        // Customer URLs can contain share tokens and resource identifiers.
        // Record the sanitized error code and deployment only.
        return {
          event_id: event.event_id,
          timestamp: event.timestamp,
          platform: event.platform,
          level: event.level,
          logger: event.logger,
          message: String(event.message || 'client_error').slice(0, 80),
          release: event.release,
          environment: event.environment,
          tags: {
            error_code: String(event.tags?.error_code || 'client_error').slice(0, 80),
            deployment_sha: String(import.meta.env.VITE_GIT_COMMIT_SHA || '').slice(0, 64),
          },
        }
      },
    })
    sentryCaptureMessage = (errorCode) => Sentry.captureMessage(errorCode, {
      level: 'error',
      tags: { error_code: errorCode },
    })
  }

  if (import.meta.env.PROD && import.meta.env.VITE_ENABLE_SPEED_INSIGHTS === 'true') {
    const { injectSpeedInsights } = await import('@vercel/speed-insights')
    injectSpeedInsights({
      sampleRate: 0.5,
      beforeSend(data) {
        try {
          const url = new URL(data.url)
          if (/^\/report-shares\//.test(url.pathname) || /^\/projects\/[^/]+\/reports\//.test(url.pathname)) {
            return null
          }
          return { ...data, url: `${url.origin}${url.pathname}` }
        } catch {
          return null
        }
      },
    })
  }
}

export function captureSafeClientError(errorCode) {
  const code = String(errorCode || 'client_error').slice(0, 80)
  reportClientEvent('error', 'client_exception', { error_code: code })
  sentryCaptureMessage?.(code)
}

export function installSafeClientErrorHandlers() {
  const onRejection = (event) => {
    captureSafeClientError('client_unhandled_rejection')
    event.preventDefault()
  }
  const onError = () => {
    captureSafeClientError('client_uncaught_error')
  }
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  return () => {
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('error', onError)
  }
}
