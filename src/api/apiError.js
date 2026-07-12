const FALLBACK_CATEGORY = 'unexpected'

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * Normalize the public API error contract while accepting legacy responses.
 *
 * New responses use `{ ok: false, error: { ... } }`. During the hybrid
 * migration older endpoints can still return string `error`, `detail`, or
 * `error_code` fields. Keeping the compatibility logic here prevents backend
 * implementation details from leaking into customer-facing screens.
 */
export function normalizeApiError(body, status, fallbackMessage = '') {
  const payload = body && typeof body === 'object' ? body : {}
  const problem = payload.error && typeof payload.error === 'object'
    ? payload.error
    : {}
  const legacyError = asNonEmptyString(payload.error)

  const code = asNonEmptyString(problem.code)
    || asNonEmptyString(payload.error_code)
    || legacyError
    || `http_${status || 0}`
  const message = asNonEmptyString(problem.user_message)
    || asNonEmptyString(payload.user_message)
    || asNonEmptyString(payload.detail)
    || asNonEmptyString(payload.message)
    || fallbackMessage
    || '処理を完了できませんでした。時間をおいて再試行してください。'

  return {
    code,
    category: asNonEmptyString(problem.category)
      || asNonEmptyString(payload.category)
      || FALLBACK_CATEGORY,
    message,
    retryable: typeof problem.retryable === 'boolean'
      ? problem.retryable
      : Boolean(payload.retryable),
    requestId: asNonEmptyString(problem.request_id)
      || asNonEmptyString(payload.request_id)
      || '',
    fieldErrors: problem.field_errors && typeof problem.field_errors === 'object'
      ? problem.field_errors
      : payload.field_errors && typeof payload.field_errors === 'object'
        ? payload.field_errors
        : {},
  }
}

export function apiErrorSearchText(body, status) {
  const normalized = normalizeApiError(body, status)
  return [normalized.code, normalized.category, normalized.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
