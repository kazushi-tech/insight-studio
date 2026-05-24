import { execFileSync, spawn } from 'node:child_process'

const EXAMPLE_BASE_URL = 'https://insight-studio-chi.vercel.app'
const START_PREVIEW = process.env.AI_EXPLORER_START_PREVIEW === '1'
const SKIP_API = process.env.AI_EXPLORER_SKIP_API === '1'
const API_ONLY = process.env.AI_EXPLORER_API_ONLY === '1'
const RUN_LIVE = process.env.RUN_LIVE_AI_E2E === '1'
const DEFAULT_BASE_URL = START_PREVIEW ? 'http://127.0.0.1:3002' : EXAMPLE_BASE_URL
const LIVE_PAYLOAD_JSON = process.env.AI_EXPLORER_LIVE_PAYLOAD_JSON || ''

function normalizeBaseUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error(`AI_EXPLORER_BASE_URL is empty. Example: AI_EXPLORER_BASE_URL=${EXAMPLE_BASE_URL} node scripts/verify-ai-explorer-production.mjs`)
  }

  const withoutTrailingSlash = raw.replace(/\/+$/, '')
  const invalidTrailingColon = /^https?:\/\/[^/?#]+:$/.test(withoutTrailingSlash)
  const invalidColonBeforePath = /^https?:\/\/[^/?#]*[^\d]:\//.test(withoutTrailingSlash)
  if (invalidTrailingColon || invalidColonBeforePath) {
    throw new Error(
      [
        `Invalid AI_EXPLORER_BASE_URL: ${raw}`,
        'The base URL must be an origin only and must not contain a dangling colon.',
        `Correct example: AI_EXPLORER_BASE_URL=${EXAMPLE_BASE_URL} node scripts/verify-ai-explorer-production.mjs`,
      ].join('\n'),
    )
  }

  let parsed
  try {
    parsed = new URL(withoutTrailingSlash)
  } catch (error) {
    throw new Error(
      [
        `Invalid AI_EXPLORER_BASE_URL: ${raw}`,
        error.message,
        `Correct example: AI_EXPLORER_BASE_URL=${EXAMPLE_BASE_URL} node scripts/verify-ai-explorer-production.mjs`,
      ].join('\n'),
    )
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`AI_EXPLORER_BASE_URL must start with http:// or https://. Received: ${raw}`)
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(
      [
        `AI_EXPLORER_BASE_URL must be the origin only, not a page/API URL: ${raw}`,
        `Use: ${parsed.origin}`,
        `Correct example: AI_EXPLORER_BASE_URL=${EXAMPLE_BASE_URL} node scripts/verify-ai-explorer-production.mjs`,
      ].join('\n'),
    )
  }

  return parsed.origin
}

const BASE_URL = normalizeBaseUrl(process.env.AI_EXPLORER_BASE_URL || DEFAULT_BASE_URL)
const CORS_ORIGIN = normalizeBaseUrl(process.env.AI_EXPLORER_CORS_ORIGIN || (API_ONLY ? EXAMPLE_BASE_URL : BASE_URL))
const PORT = new URL(BASE_URL).port || '3002'

const pageChecks = [
  { kind: 'page', method: 'GET', path: '/insights/ai', expected: [200] },
  { kind: 'page', method: 'GET', path: '/ads/ai', expected: [200, 301, 302, 307, 308] },
]

const apiChecks = [
  { kind: 'api-health', method: 'GET', path: '/api/insights/neon/health', expected: [200], requireJson: true },
  { kind: 'api-health', method: 'GET', path: '/api/ads/neon/health', expected: [200], requireJson: true },
  { kind: 'api-options', method: 'OPTIONS', path: '/api/insights/neon/generate', expected: [200, 204] },
  { kind: 'api-options', method: 'OPTIONS', path: '/api/ads/neon/generate', expected: [200, 204] },
  {
    kind: 'api-generate-probe',
    method: 'POST',
    path: '/api/insights/neon/generate',
    expected: [200, 400, 401, 403, 422],
    requireBackendSignal: true,
    body: { mode: 'question' },
  },
  {
    kind: 'api-generate-probe',
    method: 'POST',
    path: '/api/ads/neon/generate',
    expected: [200, 400, 401, 403, 422],
    requireBackendSignal: true,
    body: { mode: 'question' },
  },
]

function parseLivePayload() {
  if (!LIVE_PAYLOAD_JSON) return null
  try {
    const payload = JSON.parse(LIVE_PAYLOAD_JSON)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be a JSON object')
    }
    return payload
  } catch (error) {
    throw new Error(`AI_EXPLORER_LIVE_PAYLOAD_JSON is invalid: ${error.message}`)
  }
}

function pickHeaders(headers) {
  const names = [
    'content-type',
    'location',
    'server',
    'x-vercel-id',
    'x-render-origin-server',
    'x-render-routing',
    'access-control-allow-origin',
    'access-control-allow-methods',
  ]
  return Object.fromEntries(
    names
      .map((name) => [name, headers.get(name)])
      .filter(([, value]) => value),
  )
}

function hasBackendSignal(result) {
  if (!result.bodyStart) return false
  if (!String(result.headers?.['content-type'] || '').includes('json')) return false
  return /"ok"|api_key_required|Unauthorized|message is empty|point pack|service|ads-insights/.test(result.bodyStart)
}

async function runCheck(check) {
  const url = `${BASE_URL}${check.path}`
  const headers = {
    'X-Client-ID': 'ai-explorer-production-verify',
  }
  if (check.method === 'OPTIONS') {
    headers.Origin = CORS_ORIGIN
    headers['Access-Control-Request-Method'] = 'POST'
    headers['Access-Control-Request-Headers'] = 'content-type,x-client-id,authorization'
  }
  const init = {
    method: check.method,
    headers,
    redirect: 'manual',
  }
  if (check.body) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(check.body)
  }

  const res = await fetch(url, init)
  const text = await res.text().catch(() => '')
  const result = {
    kind: check.kind,
    method: check.method,
    path: check.path,
    status: res.status,
    ok: check.expected.includes(res.status),
    headers: pickHeaders(res.headers),
    bodyStart: text.slice(0, 500),
  }

  if (check.requireJson && !String(result.headers['content-type'] || '').includes('json')) {
    result.ok = false
    result.reason = 'Expected JSON response from backend'
  }
  if (check.requireBackendSignal && !hasBackendSignal(result)) {
    result.ok = false
    result.reason = 'Response did not look like the ads-insights backend'
  }
  if (check.path.includes('/api/insights/') && res.status === 405) {
    result.reason = '405 suggests the neutral API rewrite is not reaching the ads-insights backend, or the method is not allowed before FastAPI handles it'
  }

  return result
}

async function waitForServer(timeoutMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/insights/ai`)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${BASE_URL}`)
}

function startPreviewIfNeeded() {
  if (!START_PREVIEW) return null
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `npm run preview -- --host 127.0.0.1 --port ${PORT}`]]
    : ['npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', PORT]]
  return spawn(command[0], command[1], {
    cwd: process.cwd(),
    stdio: 'ignore',
    shell: false,
  })
}

function stopPreview(processHandle) {
  if (!processHandle) return
  if (process.platform === 'win32' && processHandle.pid) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(processHandle.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch {
      // fallback
    }
  }
  processHandle.kill('SIGTERM')
}

async function main() {
  const preview = startPreviewIfNeeded()
  const results = []
  try {
    if (START_PREVIEW && !API_ONLY) await waitForServer()

    if (!API_ONLY) {
      for (const check of pageChecks) {
        try {
          results.push(await runCheck(check))
        } catch (error) {
          results.push({ kind: check.kind, method: check.method, path: check.path, status: 'NETWORK_ERROR', ok: false, error: error?.message || String(error) })
        }
      }
    } else {
      results.push({ kind: 'page', method: 'GET', path: '/insights/ai', status: 'SKIPPED', ok: true, reason: 'AI_EXPLORER_API_ONLY=1' })
      results.push({ kind: 'page', method: 'GET', path: '/ads/ai', status: 'SKIPPED', ok: true, reason: 'AI_EXPLORER_API_ONLY=1' })
    }

    for (const check of apiChecks) {
      if (SKIP_API) {
        results.push({ kind: check.kind, method: check.method, path: check.path, status: 'SKIPPED', ok: true, reason: 'AI_EXPLORER_SKIP_API=1' })
        continue
      }
      try {
        results.push(await runCheck(check))
      } catch (error) {
        results.push({ kind: check.kind, method: check.method, path: check.path, status: 'NETWORK_ERROR', ok: false, error: error?.message || String(error) })
      }
    }

    const livePayload = RUN_LIVE ? parseLivePayload() : null
    if (RUN_LIVE && livePayload) {
      const liveChecks = [
        {
          kind: 'api-live-generate',
          method: 'POST',
          path: '/api/insights/neon/generate',
          expected: [200],
          requireJson: true,
          body: livePayload,
        },
      ]
      for (const check of liveChecks) {
        try {
          const result = await runCheck(check)
          try {
            const data = JSON.parse(result.bodyStart)
            result.liveAssertions = {
              hasAnswerMarkdown: Boolean(data.answer_markdown),
              parseStatusJson: data.parse_status === 'json',
              fallbackUnused: data.fallback_used === false,
              hasRequiredHeadings: Boolean(data.answer_markdown && data.answer_markdown.includes('結論') && data.answer_markdown.includes('数値根拠')),
            }
            result.ok = result.ok && Object.values(result.liveAssertions).every(Boolean)
          } catch {
            result.ok = false
            result.reason = 'Live response was not parseable JSON'
          }
          results.push(result)
        } catch (error) {
          results.push({ kind: check.kind, method: check.method, path: check.path, status: 'NETWORK_ERROR', ok: false, error: error?.message || String(error) })
        }
      }
    } else if (RUN_LIVE) {
      results.push({
        kind: 'api-live-generate',
        method: 'POST',
        path: '/api/insights/neon/generate',
        status: 'SKIPPED',
        ok: true,
        reason: 'RUN_LIVE_AI_E2E=1 but AI_EXPLORER_LIVE_PAYLOAD_JSON is not set',
      })
    } else {
      results.push({ kind: 'api-live-generate', method: 'POST', path: '/api/insights/neon/generate', status: 'SKIPPED', ok: true, reason: 'RUN_LIVE_AI_E2E is not 1' })
    }

    console.log(JSON.stringify({ baseUrl: BASE_URL, corsOrigin: CORS_ORIGIN, apiOnly: API_ONLY, runLive: RUN_LIVE, results }, null, 2))

    const failed = results.filter((item) => !item.ok)
    if (failed.length > 0) {
      throw new Error(`AI Explorer production verification failed: ${failed.map((item) => `${item.method || ''} ${item.path}:${item.status}`).join(', ')}`)
    }
  } finally {
    stopPreview(preview)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
