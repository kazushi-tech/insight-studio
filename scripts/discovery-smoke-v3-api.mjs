/**
 * Discovery Phase A v3 Smoke Test (API-based)
 *
 * Target: https://www.petabit.co.jp
 * Origin: http://127.0.0.1:3002 (local proxy → Render)
 * Attempts: 5
 *
 * Comparison baseline: v2 = 3/5 success (60%)
 * - stage=search SSL/TLS: 1
 * - stage=search timeout: 1
 * - stage=analyze provider 503: 0
 */

const PROXY_BASE = 'http://127.0.0.1:3002'
const DISCOVERY_PATH = '/api/ml/discovery/analyze'
const BRAND_URL = 'https://www.petabit.co.jp'
const ATTEMPTS = 5
const TIMEOUT_MS = 180_000

const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''

const API_KEY = CLAUDE_KEY
const PROVIDER = CLAUDE_KEY ? 'anthropic' : ''

if (!API_KEY) {
  console.warn('[smoke] No API key found.')
}

function getJSTTimestamp() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
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
    return { stage: stage || 'search', type: 'SSL/TLS', detail }
  }
  if (status === 503 || detailLower.includes('overload') || detailLower.includes('503') || detailLower.includes('unavailable')) {
    return { stage: stage || 'analyze', type: 'provider_503', detail }
  }
  if (status === 401 || status === 403) {
    return { stage: stage || 'unknown', type: 'auth_error', detail }
  }
  if (status === 502) {
    // Distinguish between timeout and other 502s
    if (detailLower.includes('timeout') || detailLower.includes('timed out')) {
      return { stage: stage || 'search', type: 'upstream_502 (timeout)', detail }
    }
    return { stage: stage || 'search', type: 'upstream_502', detail }
  }
  if (detailLower.includes('failed to fetch') || detailLower.includes('network')) {
    return { stage: stage || 'unknown', type: 'frontend_regression', detail }
  }
  return { stage: stage || 'unknown', type: 'unknown', detail }
}

async function runAttempt(n) {
  const t0 = Date.now()
  const ts = getJSTTimestamp()
  const record = {
    attempt: n,
    timestamp: ts,
    origin: PROXY_BASE,
    path: DISCOVERY_PATH,
    brand_url: BRAND_URL,
    status: null,
    stage: null,
    errorClass: '-',
    uiMessage: '-',
    elapsed_sec: null,
    result: 'unknown',
    fetched_sites: null,
    report_present: false,
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
    record.elapsed_sec = ((Date.now() - t0) / 1000).toFixed(1)

    const body = await res.json().catch(() => ({}))

    if (res.ok) {
      record.result = 'success'
      record.stage = 'complete'
      record.errorClass = '-'
      record.fetched_sites = body.fetched_sites || body.candidate_count || null
      record.report_present = !!(body.report_md || body.report)
      record.uiMessage = 'Report generated successfully'
    } else {
      const cls = classifyFailure(res.status, body)
      record.result = 'failure'
      record.stage = cls.stage
      record.errorClass = cls.type
      record.uiMessage = cls.detail?.slice(0, 150) || `HTTP ${res.status}`
    }
  } catch (err) {
    record.elapsed_sec = ((Date.now() - t0) / 1000).toFixed(1)
    if (err.name === 'AbortError') {
      record.status = 'timeout'
      record.stage = 'unknown'
      record.result = 'failure'
      record.errorClass = 'timeout'
      record.uiMessage = `Timeout after ${TIMEOUT_MS/1000}s`
    } else {
      record.status = 'error'
      record.stage = 'unknown'
      record.result = 'failure'
      record.errorClass = 'frontend_regression'
      record.uiMessage = err.message?.slice(0, 150)
    }
  }

  return record
}

async function main() {
  console.log('=== Discovery Phase A v3 Smoke (API) ===')
  console.log(`Started: ${getJSTTimestamp()} JST`)
  console.log(`Target: ${BRAND_URL}`)
  console.log(`Origin: ${PROXY_BASE}`)
  console.log(`Attempts: ${ATTEMPTS}`)
  console.log(`Timeout: ${TIMEOUT_MS}ms`)
  console.log(`Provider: ${PROVIDER || 'none'}`)
  console.log('')

  // Pre-check: health
  try {
    const hRes = await fetch(`${PROXY_BASE}/api/ml/health`, { signal: AbortSignal.timeout(10000) })
    const hBody = await hRes.json().catch(() => ({}))
    console.log(`[health] ${hRes.status} — commit: ${hBody.commit || 'unknown'}`)
  } catch (e) {
    console.log(`[health] FAILED — ${e.message}`)
    return
  }
  console.log('')

  const results = []

  for (let i = 1; i <= ATTEMPTS; i++) {
    console.log(`--- Attempt ${i}/${ATTEMPTS} ---`)
    const r = await runAttempt(i)
    results.push(r)

    const icon = r.result === 'success' ? '✓ OK' : '✗ FAIL'
    console.log(`[${icon}] status=${r.status} stage=${r.stage} class=${r.errorClass} elapsed=${r.elapsed_sec}s`)
    if (r.result === 'success') {
      console.log(`    fetched_sites=${r.fetched_sites} report=${r.report_present}`)
    } else {
      console.log(`    msg="${r.uiMessage?.slice(0, 100)}"`)
    }
    console.log('')

    if (i < ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }

  // Summary
  const successes = results.filter(r => r.result === 'success')
  const failures = results.filter(r => r.result === 'failure')

  console.log('=== SUMMARY TABLE ===')
  console.log('| # | Timestamp (JST) | Status | Stage | Class | Elapsed | Result |')
  console.log('|---|-----------------|--------|-------|-------|---------|--------|')
  for (const r of results) {
    console.log(`| ${r.attempt} | ${r.timestamp} | ${r.status} | ${r.stage} | ${r.errorClass} | ${r.elapsed_sec}s | ${r.result} |`)
  }
  console.log('')

  console.log(`Success: ${successes.length}/${ATTEMPTS} (${((successes.length/ATTEMPTS)*100).toFixed(0)}%)`)
  console.log(`Failure: ${failures.length}/${ATTEMPTS} (${((failures.length/ATTEMPTS)*100).toFixed(0)}%)`)
  console.log('')

  if (failures.length > 0) {
    console.log('Failure breakdown:')
    const byClass = {}
    for (const f of failures) {
      const key = `stage=${f.stage} + ${f.errorClass}`
      byClass[key] = (byClass[key] || 0) + 1
    }
    for (const [k, v] of Object.entries(byClass)) {
      console.log(`  ${k}: ${v}`)
    }
    console.log('')
  }

  // Regression check
  const genericTransport = failures.filter(f => f.errorClass === 'frontend_regression')
  if (genericTransport.length > 0) {
    console.log('⚠️ WARNING: Generic transport error detected — possible code regression!')
  } else if (failures.length > 0) {
    console.log('✓ No generic transport regression. Failures are infra/provider related.')
  }

  // Comparison with v2
  console.log('')
  console.log('=== COMPARISON WITH v2 BASELINE ===')
  console.log(`| Metric | v2 (74a86d7) | v3 (Phase A) | Change |`)
  console.log(`|--------|-------------|--------------|--------|`)
  console.log(`| Success Rate | 3/5 (60%) | ${successes.length}/${ATTEMPTS} (${((successes.length/ATTEMPTS)*100).toFixed(0)}%) | ${successes.length > 3 ? 'IMPROVED' : successes.length < 3 ? 'DEGRADED' : 'NO CHANGE'} |`)

  const sslTls = failures.filter(f => f.errorClass === 'SSL/TLS').length
  const timeout = failures.filter(f => f.errorClass.includes('timeout') || f.errorClass.includes('502')).length
  const provider503 = failures.filter(f => f.errorClass === 'provider_503').length

  console.log(`| SSL/TLS (search) | 1 | ${sslTls} | ${sslTls < 1 ? 'IMPROVED' : sslTls > 1 ? 'DEGRADED' : 'NO CHANGE'} |`)
  console.log(`| Timeout (search) | 1 | ${timeout} | ${timeout < 1 ? 'IMPROVED' : timeout > 1 ? 'DEGRADED' : 'NO CHANGE'} |`)
  console.log(`| Provider 503 (analyze) | 0 | ${provider503} | ${provider503 === 0 ? 'MAINTAINED' : 'DEGRADED'} |`)

  console.log('')
  console.log('=== RAW JSON ===')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(e => {
  console.error('[fatal]', e)
  process.exit(1)
})
