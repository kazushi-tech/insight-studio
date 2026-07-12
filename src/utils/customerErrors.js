const ERROR_KINDS = Object.freeze({
  AUTH: 'auth',
  PERMISSION: 'permission',
  TIMEOUT: 'timeout',
  COLD_START: 'cold_start',
  NETWORK: 'network',
  NO_DATA: 'no_data',
  UNKNOWN: 'unknown',
})

export const CUSTOMER_ERROR_KINDS = ERROR_KINDS

const CUSTOMER_ERROR_COPY = Object.freeze({
  [ERROR_KINDS.AUTH]: {
    title: 'ログイン状態の確認が必要です',
    body: '安全のため接続が終了しました。もう一度ログインしてください。',
    actionLabel: 'ログインし直す',
    retryable: false,
  },
  [ERROR_KINDS.PERMISSION]: {
    title: 'このデータを表示できません',
    body: 'この案件を見る権限があるか、管理者に確認してください。',
    actionLabel: '設定を確認する',
    retryable: false,
  },
  [ERROR_KINDS.TIMEOUT]: {
    title: '読み込みに時間がかかっています',
    body: '少し時間をおいて、もう一度お試しください。',
    actionLabel: 'もう一度試す',
    retryable: true,
  },
  [ERROR_KINDS.COLD_START]: {
    title: 'データを準備しています',
    body: '準備が終わるまで少し待ってから、もう一度お試しください。',
    actionLabel: 'もう一度試す',
    retryable: true,
  },
  [ERROR_KINDS.NETWORK]: {
    title: '通信できませんでした',
    body: 'インターネット接続を確認して、もう一度お試しください。',
    actionLabel: 'もう一度試す',
    retryable: true,
  },
  [ERROR_KINDS.NO_DATA]: {
    title: 'この期間は判断できるデータがありません',
    body: '期間または接続設定を確認して、表示する期間を選び直してください。',
    actionLabel: '期間を選び直す',
    retryable: false,
  },
  [ERROR_KINDS.UNKNOWN]: {
    title: 'データを表示できませんでした',
    body: '時間をおいても直らない場合は、管理者にお問い合わせください。',
    actionLabel: 'もう一度試す',
    retryable: true,
  },
})

function statusOf(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.body?.status,
  ]
  for (const candidate of candidates) {
    const status = Number(candidate)
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  return null
}

function codeOf(error) {
  const problem = isProblemObject(error?.error)
    ? error.error
    : isProblemObject(error?.body?.error) ? error.body.error : {}
  return String(
    error?.code ?? problem.code ?? error?.error_code ?? error?.body?.code ?? error?.body?.error_code ?? '',
  ).trim().toLowerCase()
}

function messageOf(error) {
  const problem = isProblemObject(error?.error)
    ? error.error
    : isProblemObject(error?.body?.error) ? error.body.error : {}
  const candidates = [
    error?.message,
    error?.user_message,
    problem.user_message,
    error?.body?.message,
    error?.body?.user_message,
    error?.body?.detail,
    typeof error === 'string' ? error : '',
  ]
  return candidates.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

function isProblemObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function categoryOf(error) {
  const problem = isProblemObject(error?.error)
    ? error.error
    : isProblemObject(error?.body?.error) ? error.body.error : {}
  return String(error?.category ?? problem.category ?? error?.body?.category ?? '').trim().toLowerCase()
}

function classifyCustomerError(error) {
  const status = statusOf(error)
  const code = codeOf(error)
  const category = categoryOf(error)
  const message = messageOf(error).toLowerCase()
  const evidence = `${code} ${category} ${message}`

  if (status === 401 || error?.isAuthError === true || category === 'authentication') return ERROR_KINDS.AUTH
  if (status === 403 || category === 'authorization') return ERROR_KINDS.PERMISSION
  if (/unauth|token.?expired|jwt|login.?required|認証|ログイン.*必要/.test(evidence)) return ERROR_KINDS.AUTH
  if (/forbidden|permission.?denied|access.?denied|権限/.test(evidence)) return ERROR_KINDS.PERMISSION

  if (
    status === 408 || status === 504 || category === 'rate_limit' || error?.name === 'TimeoutError' ||
    /timeout|timed.?out|etimedout|タイムアウト|時間切れ/.test(evidence)
  ) return ERROR_KINDS.TIMEOUT

  if (
    status === 204 || category === 'configuration' || code === 'no_data' ||
    /no[_ -]?data|empty[_ -]?result|not[_ -]?measured|データ.*(?:ありません|見つかりません|未取得)|0件/.test(evidence)
  ) return ERROR_KINDS.NO_DATA

  if (
    [502, 503].includes(status) || category === 'dependency' ||
    /cold.?start|service.?unavailable|upstream|starting|waking|起動中|準備中/.test(evidence)
  ) return ERROR_KINDS.COLD_START

  if (
    error?.name === 'TypeError' || error?.name === 'NetworkError' ||
    /network|failed.?to.?fetch|fetch.?failed|econn|dns|offline|通信|接続でき/.test(evidence)
  ) return ERROR_KINDS.NETWORK

  return ERROR_KINDS.UNKNOWN
}

function sanitizeTechnicalDetails(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,&]+/gi, '$1=[REDACTED]')
    .replace(/([?&][^=\s]+)=([^&\s]+)/g, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 400)
}

/**
 * Convert transport/backend errors into a stable customer-facing state.
 * Raw messages are never returned to customer roles. Sanitized details are
 * available only when an admin caller explicitly opts in.
 */
export function normalizeCustomerError(error, context = {}) {
  const kind = classifyCustomerError(error)
  const copy = CUSTOMER_ERROR_COPY[kind]
  const status = statusOf(error)
  const isAdmin = ['admin', 'operator', 'staff'].includes(String(context.role ?? '').toLowerCase())
  const details = isAdmin && context.includeTechnicalDetails === true
    ? sanitizeTechnicalDetails(messageOf(error)) || null
    : null
  const problem = isProblemObject(error?.error)
    ? error.error
    : isProblemObject(error?.body?.error) ? error.body.error : {}
  const explicitRetryable = typeof error?.retryable === 'boolean'
    ? error.retryable
    : typeof problem.retryable === 'boolean' ? problem.retryable : undefined

  return {
    kind,
    title: context.title || copy.title,
    body: context.body || copy.body,
    actionLabel: context.actionLabel || copy.actionLabel,
    retryable: context.retryable ?? explicitRetryable ?? copy.retryable,
    status,
    details,
  }
}
