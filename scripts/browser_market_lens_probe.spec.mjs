import { test } from '@playwright/test'

const DEFAULT_TIMEOUT_MS = 45000
const DIRECT_BASE = 'https://market-lens-ai.onrender.com/api'
const PROXY_BASE = '/api/ml'
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aQ0AAAAASUVORK5CYII='

async function probeFromPage(page, { label, baseUrl, path, method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return page.evaluate(async ({ label, baseUrl, path, method, headers, body, timeoutMs }) => {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await response.text()
      return {
        label,
        ok: response.ok,
        kind: 'http',
        status: response.status,
        durationMs: Date.now() - startedAt,
        text: text.slice(0, 800),
      }
    } catch (error) {
      return {
        label,
        ok: false,
        kind: error?.name === 'AbortError' ? 'timeout' : 'exception',
        errorName: error?.name || 'Error',
        errorMessage: error?.message || String(error),
        durationMs: Date.now() - startedAt,
      }
    }
  }, { label, baseUrl, path, method, headers, body, timeoutMs })
}

async function uploadAssetViaProxy(page) {
  return page.evaluate(async ({ proxyBase, pngBase64 }) => {
    const binary = atob(pngBase64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'image/png' })
    const formData = new FormData()
    formData.append('file', new File([blob], 'probe.png', { type: 'image/png' }))

    const response = await fetch(`${proxyBase}/assets`, {
      method: 'POST',
      body: formData,
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return {
      ok: response.ok,
      status: response.status,
      text: text.slice(0, 800),
      json,
    }
  }, {
    proxyBase: PROXY_BASE,
    pngBase64: VALID_PNG_BASE64,
  })
}

test('browser-side direct vs proxy probe', async ({ page }) => {
  test.setTimeout(240000)
  const appBaseUrl = process.env.INSIGHT_STUDIO_BASE_URL || 'http://127.0.0.1:3004'
  const clientId = process.env.INSIGHT_STUDIO_CLIENT_ID || `browser-probe-${Date.now()}`
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-Insight-User': `guest:${clientId}`,
  }

  page.on('console', (msg) => {
    console.log(`[console:${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    console.log(`[requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`)
  })
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/api/ml') && !url.includes('market-lens-ai.onrender.com/api')) return
    console.log(`[response] ${response.status()} ${response.request().method()} ${url}`)
  })

  await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' })

  console.log('\n--- proxy-upload ---')
  const uploadResult = await uploadAssetViaProxy(page)
  console.log(JSON.stringify(uploadResult, null, 2))

  const assetId = uploadResult.json?.asset_id || ''

  const cases = [
    { label: 'direct-health', baseUrl: DIRECT_BASE, path: '/health' },
    { label: 'proxy-health', baseUrl: PROXY_BASE, path: '/health' },
    {
      label: 'direct-scan',
      baseUrl: DIRECT_BASE,
      path: '/scan',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        urls: ['https://www.petabit.co.jp', 'https://www.openai.com', 'https://www.anthropic.com'],
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
    },
    {
      label: 'proxy-scan',
      baseUrl: PROXY_BASE,
      path: '/scan',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        urls: ['https://www.petabit.co.jp', 'https://www.openai.com', 'https://www.anthropic.com'],
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
      timeoutMs: 180000,
    },
    {
      label: 'direct-discovery',
      baseUrl: DIRECT_BASE,
      path: '/discovery/analyze',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        brand_url: 'https://www.petabit.co.jp',
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
    },
    {
      label: 'proxy-discovery',
      baseUrl: PROXY_BASE,
      path: '/discovery/analyze',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        brand_url: 'https://www.petabit.co.jp',
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
      timeoutMs: 180000,
    },
    {
      label: 'direct-review-banner',
      baseUrl: DIRECT_BASE,
      path: '/reviews/banner',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        asset_id: assetId,
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
    },
    {
      label: 'proxy-review-banner',
      baseUrl: PROXY_BASE,
      path: '/reviews/banner',
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        asset_id: assetId,
        api_key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
        provider: 'claude',
        model: 'claude-3-7-sonnet-latest',
      }),
      timeoutMs: 180000,
    },
  ]

  const results = []
  for (const probeCase of cases) {
    console.log(`\n--- ${probeCase.label} ---`)
    const result = await probeFromPage(page, probeCase)
    console.log(JSON.stringify(result, null, 2))
    results.push(result)
  }

  console.log('\n=== probe-summary ===')
  console.log(JSON.stringify(results, null, 2))
})
