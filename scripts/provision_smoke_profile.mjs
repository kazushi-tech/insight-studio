import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const args = { out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--out') {
      args.out = argv[index + 1] || null
      index += 1
    }
  }
  return args
}

function splitCsv(value, fallback) {
  const source = value || fallback
  return source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok, body }
}

function pickPeriods(periodsPayload, limit) {
  const rawPeriods =
    periodsPayload?.periods ??
    periodsPayload?.results ??
    periodsPayload?.available_periods ??
    (Array.isArray(periodsPayload) ? periodsPayload : [])

  return rawPeriods
    .map((entry) => (typeof entry === 'string' ? entry : entry?.period_tag || entry?.value || entry?.period))
    .filter(Boolean)
    .slice(0, limit)
}

function maskSecret(value) {
  if (!value || typeof value !== 'string') return value
  if (value.length <= 8) return '[redacted]'
  return `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`
}

function createRedactedManifest(manifest) {
  return {
    ...manifest,
    auth: {
      ...manifest.auth,
      body: manifest.auth?.body
        ? {
            ...manifest.auth.body,
            token: manifest.auth.body.token ? maskSecret(manifest.auth.body.token) : manifest.auth.body.token,
          }
        : manifest.auth?.body,
    },
    caseLogin: {
      ...manifest.caseLogin,
      body: manifest.caseLogin?.body
        ? {
            ...manifest.caseLogin.body,
            token: manifest.caseLogin.body.token ? maskSecret(manifest.caseLogin.body.token) : manifest.caseLogin.body.token,
          }
        : manifest.caseLogin?.body,
    },
    localStorageEntries: Object.fromEntries(
      Object.entries(manifest.localStorageEntries || {}).map(([key, value]) => {
        if (key === 'is_ads_token' || key === 'is_claude_key' || key === 'is_gemini_key') {
          return [key, maskSecret(value)]
        }
        return [key, value]
      }),
    ),
  }
}

export async function provisionSmokeProfile(options = {}) {
  const baseUrl = (options.baseUrl || process.env.INSIGHT_STUDIO_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '')
  const appPassword = options.appPassword || process.env.INSIGHT_STUDIO_APP_PASSWORD || 'aQWkTCzrYF6b4xiV3=na19ID'
  const caseId = options.caseId || process.env.INSIGHT_STUDIO_CASE_ID || 'petabit'
  const granularity = options.granularity || process.env.INSIGHT_STUDIO_GRANULARITY || 'monthly'
  const queryTypes = options.queryTypes || splitCsv(process.env.INSIGHT_STUDIO_QUERY_TYPES, 'pv')
  const periodCount = Number(options.periodCount || process.env.INSIGHT_STUDIO_PERIOD_COUNT || '1')
  const clientId = options.clientId || process.env.INSIGHT_STUDIO_CLIENT_ID || `smoke-${Date.now()}`

  const baseHeaders = {
    'Content-Type': 'application/json',
    'X-Client-ID': clientId,
  }

  const auth = await requestJson(baseUrl, '/api/ads/auth/login', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ password: appPassword }),
  })

  const caseLogin = await requestJson(baseUrl, '/api/ads/cases/login', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ case_id: caseId, password: appPassword }),
  })

  const token = auth.body?.token || caseLogin.body?.token || ''
  const authHeaders = token
    ? { ...baseHeaders, Authorization: `Bearer ${token}` }
    : { ...baseHeaders }

  const periods = await requestJson(
    baseUrl,
    `/api/ads/bq/periods?granularity=${encodeURIComponent(granularity)}&dataset_id=${encodeURIComponent(caseLogin.body?.dataset_id || '')}`,
    { headers: authHeaders },
  )

  const selectedPeriods = pickPeriods(periods.body, Math.max(1, periodCount))
  const generate = []

  for (const period of selectedPeriods) {
    generate.push(await requestJson(baseUrl, '/api/ads/bq/generate_batch', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        query_types: queryTypes,
        dataset_id: caseLogin.body?.dataset_id,
        period,
      }),
    }))
  }

  const caseInfo = {
    case_id: caseLogin.body?.case_id || caseId,
    name: caseLogin.body?.name || caseId,
    dataset_id: caseLogin.body?.dataset_id || null,
  }

  const setupState = caseInfo.dataset_id && selectedPeriods.length > 0
    ? {
        version: 3,
        queryTypes,
        periods: selectedPeriods,
        granularity,
        datasetId: caseInfo.dataset_id,
        completedAt: new Date().toISOString(),
      }
    : null

  const localStorageEntries = {
    'insight-studio-guide-seen': '1',
    'insight-studio-client-id': clientId,
    'insight-studio-current-case': JSON.stringify(caseInfo),
    'insight-studio-case-authenticated': String(caseLogin.ok),
  }

  if (token) {
    localStorageEntries.is_ads_token = token
  }
  if (setupState) {
    localStorageEntries[`insight-studio-ads-setup:${caseInfo.case_id}`] = JSON.stringify(setupState)
  }

  const geminiKey = options.geminiKey || process.env.GEMINI_API_KEY || ''
  const claudeKey = options.claudeKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''

  if (geminiKey) localStorageEntries.is_gemini_key = geminiKey
  if (claudeKey) localStorageEntries.is_claude_key = claudeKey

  const blockers = []
  if (!claudeKey) blockers.push('Claude API key is not available from local env (`CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`).')
  if (!auth.ok) blockers.push(`Ads auth failed: ${auth.body?.detail || auth.status}`)
  if (!caseLogin.ok) blockers.push(`Case auth failed: ${caseLogin.body?.detail || caseLogin.status}`)
  if (!periods.ok) blockers.push(`BQ periods fetch failed: ${periods.body?.detail || periods.status}`)
  if (generate.some((item) => !item.ok)) blockers.push('One or more BQ generate_batch calls failed.')

  return {
    baseUrl,
    clientId,
    caseId,
    granularity,
    queryTypes,
    selectedPeriods,
    auth,
    caseLogin,
    periods,
    generate,
    setupState,
    localStorageEntries,
    blockers,
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2))
  const manifest = await provisionSmokeProfile()
  const redactedManifest = createRedactedManifest(manifest)

  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(redactedManifest, null, 2)}\n`, 'utf8')
  }

  console.log(JSON.stringify(redactedManifest, null, 2))
}
