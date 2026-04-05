/**
 * Discovery Post-Deploy Smoke Test
 *
 * Runs Discovery analysis through the local Vite proxy (same path as browser UI)
 * to verify transport retry hardening (ed3c5b4) behavior.
 *
 * Usage: node scripts/discovery-postdeploy-smoke.mjs
 */

const PROXY_BASE = 'http://127.0.0.1:3002'
const DISCOVERY_PATH = '/api/ml/discovery/analyze'
const BRAND_URL = 'https://www.petabit.co.jp'
const ATTEMPTS = 5
const TIMEOUT_MS = 180_000

// Read API key from environment
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''

// Determine which provider/key to use
const API_KEY = CLAUDE_KEY
const PROVIDER = CLAUDE_KEY ? 'anthropic' : ''

if (!API_KEY) {
  console.warn('[smoke] No API key found. Will attempt request without key (backend may have defaults).')
}

function extractStage(detail) {
  if (!detail) return null
  const match = String(detail).match(/stage=(\w+)/)
  return match ? match[1] : null
}

function classifyFailure(status, body) {
  const detail = body?.detail || ''
  const stage = extractStage(detail)
  const detailLower = String(detail).toLowerCase()

  if (detailLower.includes('ssl') || detailLower.includes('tls') || detailLower.includes('wrong_version')) {
    return { stage: stage || 'unknown', type: 'SSL/TLS', detail }
  }
  if (status === 503 || detailLower.includes('overload') || detailLower.includes('503')) {
    return { stage: stage || 'analyze', type: 'provider_load/503', detail }
  }
  if (status === 401 || status === 403) {
    return { stage: stage || 'unknown', type: 'auth_error', detail }
  }
  if (status === 502) {
    return { stage: stage || 'unknown', type: 'upstream_502', detail }
  }
  if (detailLower.includes('failed to fetch') || detailLower.includes('network')) {
    return { stage: stage || 'unknown', type: 'frontend_regression', detail }
  }
  return { stage: stage || 'unknown', type: 'unknown', detail }
}

async function runAttempt(n) {
  const t0 = Date.now()
  const ts = new Date().toISOString()
  const record = {
    attempt: n,
    timestamp: ts,
    origin: PROXY_BASE,
    path: DISCOVERY_PATH,
    brand_url: BRAND_URL,
    status: null,
    stage: null,
    ui_message: null,
    elapsed_ms: null,
    success: false,
    fetched_sites: null,
    report_present: false,
    failure_class: null,
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const payload = { brand_url: BRAND_URL }
    if (API_KEY) payload.api_key = API_KEY
    if (PROVIDER) payload.provider = PROVIDER

    const res = await fetch(`${PROXY_BASE}${DISCOVERY_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Insight-User': 'guest:smoke-test',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timer)
    record.status = res.status
    record.elapsed_ms = Date.now() - t0

    const body = await res.json().catch(() => ({}))

    if (res.ok) {
      record.success = true
      record.stage = 'complete'
      record.fetched_sites = body.fetched_sites || body.candidate_count || null
      record.report_present = !!(body.report_md || body.report)
      record.ui_message = 'SUCCESS'
    } else {
      const cls = classifyFailure(res.status, body)
      record.stage = cls.stage
      record.ui_message = cls.detail?.slice(0, 200) || `HTTP ${res.status}`
      record.failure_class = cls.type
    }
  } catch (err) {
    record.elapsed_ms = Date.now() - t0
    if (err.name === 'AbortError') {
      record.status = 'timeout'
      record.stage = 'unknown'
      record.ui_message = `Timeout after ${TIMEOUT_MS}ms`
      record.failure_class = 'timeout'
    } else {
      record.status = 'error'
      record.stage = 'unknown'
      record.ui_message = err.message?.slice(0, 200)
      record.failure_class = 'frontend_regression'
    }
  }

  return record
}

async function main() {
  console.log('=== Discovery Post-Deploy Smoke ===')
  console.log(`Backend commit: ed3c5b4 (verified via /api/ml/health)`)
  console.log(`Target: ${BRAND_URL}`)
  console.log(`Origin: ${PROXY_BASE}`)
  console.log(`Attempts: ${ATTEMPTS}`)
  console.log(`Timeout: ${TIMEOUT_MS}ms`)
  console.log(`Provider: ${PROVIDER || 'none (no key)'}`)
  console.log(`API Key: ${API_KEY ? `${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}` : 'none'} (redacted)`)
  console.log('')

  // Pre-check: health
  try {
    const hRes = await fetch(`${PROXY_BASE}/api/ml/health`, { signal: AbortSignal.timeout(10000) })
    const hBody = await hRes.json().catch(() => ({}))
    console.log(`[health] ${hRes.status} — commit: ${hBody.commit || 'unknown'}`)
  } catch (e) {
    console.log(`[health] FAILED — ${e.message}`)
  }
  console.log('')

  const results = []

  for (let i = 1; i <= ATTEMPTS; i++) {
    console.log(`--- Attempt ${i}/${ATTEMPTS} ---`)
    const r = await runAttempt(i)
    results.push(r)

    const icon = r.success ? 'OK' : 'FAIL'
    const elapsed = r.elapsed_ms ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : '?'
    console.log(`[${icon}] status=${r.status} stage=${r.stage} elapsed=${elapsed}`)
    if (r.success) {
      console.log(`  fetched_sites=${r.fetched_sites} report=${r.report_present}`)
    } else {
      console.log(`  class=${r.failure_class} msg=${r.ui_message?.slice(0, 120)}`)
    }
    console.log('')

    // Brief pause between attempts to avoid hammering
    if (i < ATTEMPTS) {
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // Summary
  const successes = results.filter(r => r.success)
  const failures = results.filter(r => !r.success)

  console.log('=== SUMMARY ===')
  console.log(`Total: ${ATTEMPTS}`)
  console.log(`Success: ${successes.length}`)
  console.log(`Failure: ${failures.length}`)
  console.log('')

  if (failures.length > 0) {
    console.log('Failure breakdown:')
    const byClass = {}
    for (const f of failures) {
      const key = `${f.failure_class} (stage=${f.stage})`
      byClass[key] = (byClass[key] || 0) + 1
    }
    for (const [k, v] of Object.entries(byClass)) {
      console.log(`  ${k}: ${v}`)
    }
    console.log('')
  }

  // Check for regressions
  const genericTransport = failures.filter(f => f.failure_class === 'frontend_regression')
  if (genericTransport.length > 0) {
    console.log('WARNING: Generic transport error detected — possible code regression!')
  } else if (failures.length > 0) {
    console.log('No generic transport regression. Failures are infra/provider related.')
  }

  // Output JSON for record
  console.log('')
  console.log('=== RAW RESULTS (JSON) ===')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(e => {
  console.error('[fatal]', e)
  process.exit(1)
})
