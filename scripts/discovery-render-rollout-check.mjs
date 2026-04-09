import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { dirname, resolve } from 'node:path'

const DEFAULTS = {
  mode: 'render',
  renderBaseUrl: 'https://market-lens-ai.onrender.com/api',
  proxyBaseUrl: 'http://localhost:3002/api/ml',
  brandUrl: 'https://www.petabit.co.jp',
  attempts: 5,
  timeoutMs: 180_000,
  pauseMs: 3_000,
  healthTimeoutMs: 60_000,
  jobStartTimeoutMs: 30_000,
  pollRequestTimeoutMs: 15_000,
  pollIntervalMs: 3_000,
  pollTransientErrorLimit: 3,
  minSuccessCount: 0,
  minSuccessRate: 0,
  label: 'discovery-async-rollout',
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue

    const eqIndex = token.indexOf('=')
    if (eqIndex >= 0) {
      const key = token.slice(2, eqIndex)
      const value = token.slice(eqIndex + 1)
      args[key] = value
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
      continue
    }
    args[key] = 'true'
  }
  return args
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizeSlug(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseDotEnv(raw) {
  const env = {}
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const content = line.startsWith('export ') ? line.slice(7).trim() : line
    const eqIndex = content.indexOf('=')
    if (eqIndex <= 0) continue

    const key = content.slice(0, eqIndex).trim()
    let value = content.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function loadEnvFiles() {
  const candidates = ['.env.local', '.env']
  for (const file of candidates) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    const parsed = parseDotEnv(readFileSync(path, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return { value, source: name }
  }
  return { value: '', source: null }
}

function resolveProvider() {
  return 'anthropic'
}

function resolveApiKey(provider) {
  if (provider === 'anthropic') {
    return firstEnv(['CLAUDE_API_KEY', 'Claude_API_KEY', 'ANTHROPIC_API_KEY'])
  }
  return { value: '', source: null }
}

function buildUrls(mode, overrideBaseUrl) {
  const baseUrl =
    overrideBaseUrl ||
    (mode === 'proxy' ? DEFAULTS.proxyBaseUrl : DEFAULTS.renderBaseUrl)

  return {
    baseUrl,
    healthUrl: `${baseUrl}/health`,
    jobsUrl: `${baseUrl}/discovery/jobs`,
  }
}

function jstTimestamp() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function detailFromBody(body) {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (typeof body?.error?.detail === 'string') return body.error.detail
  if (typeof body.detail === 'string') return body.detail
  if (typeof body.message === 'string') return body.message
  if (typeof body.error === 'string') return body.error
  if (typeof body.text === 'string') return body.text
  return JSON.stringify(body)
}

function extractStage(detail) {
  const match = String(detail).match(/stage=(\w+)/i)
  return match ? match[1].toLowerCase() : null
}

function classifyFailure(status, body, fallbackStage = 'unknown') {
  const explicitStage = typeof body?.stage === 'string' ? body.stage.toLowerCase() : null
  const detail = detailFromBody(body)
  const detailLower = detail.toLowerCase()
  const stage = explicitStage || extractStage(detail) || fallbackStage
  const effectiveStatus = Number(body?.error?.status_code || status || 0)

  if (fallbackStage === 'job_start' && (effectiveStatus === 404 || effectiveStatus === 501)) {
    return { stage: 'job_start', failureClass: 'async_endpoint_missing', detail }
  }
  if (body?.status === 'cancelled') {
    return { stage, failureClass: 'job_cancelled', detail: detail || 'Discovery job cancelled' }
  }
  if (body?.status === 'completed' && !body?.result) {
    return {
      stage: 'complete',
      failureClass: 'job_result_missing',
      detail: 'Discovery job completed without result payload',
    }
  }
  if (
    detailLower.includes('ssl') ||
    detailLower.includes('tls') ||
    detailLower.includes('wrong_version')
  ) {
    return { stage: stage || 'search', failureClass: 'SSL/TLS', detail }
  }
  if (
    detailLower.includes('timed out') ||
    detailLower.includes('timeout') ||
    detailLower.includes('request timeout')
  ) {
    return { stage: stage || 'search', failureClass: 'upstream_timeout', detail }
  }
  if (
    effectiveStatus === 503 ||
    detailLower.includes('503') ||
    detailLower.includes('unavailable') ||
    detailLower.includes('overload') ||
    detailLower.includes('busy') ||
    detailLower.includes('high demand')
  ) {
    return { stage: stage || 'analyze', failureClass: 'provider_503', detail }
  }
  if (effectiveStatus === 502) {
    return { stage: stage || 'search', failureClass: 'upstream_502', detail }
  }
  if (effectiveStatus === 401 || effectiveStatus === 403) {
    return { stage: stage || 'unknown', failureClass: 'auth_error', detail }
  }
  if (
    detailLower.includes('failed to fetch') ||
    detailLower.includes('networkerror') ||
    detailLower.includes('network error') ||
    detailLower.includes('socket hang up') ||
    detailLower.includes('econnreset') ||
    detailLower.includes('connect')
  ) {
    return { stage: stage || 'unknown', failureClass: 'frontend_regression', detail }
  }
  if (stage === 'job_start') {
    return { stage, failureClass: `job_start_${effectiveStatus || status || 'error'}`, detail }
  }
  if (stage === 'search') {
    return { stage, failureClass: 'search_error', detail }
  }
  if (stage === 'analyze') {
    return { stage, failureClass: 'analyze_error', detail }
  }
  return { stage: stage || 'unknown', failureClass: `http_${effectiveStatus || status || 0}`, detail }
}

function requestJson(urlString, options = {}) {
  const url = new URL(urlString)
  const client = url.protocol === 'http:' ? http : https

  return new Promise((resolvePromise, rejectPromise) => {
    const request = client.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'insight-studio-discovery-rollout-check',
          ...options.headers,
        },
      },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          raw += chunk
        })
        response.on('end', () => {
          let body = {}
          if (raw) {
            try {
              body = JSON.parse(raw)
            } catch {
              body = { text: raw }
            }
          }
          resolvePromise({
            status: response.statusCode || 0,
            ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
            body,
            headers: response.headers,
          })
        })
      }
    )

    request.setTimeout(options.timeoutMs || DEFAULTS.timeoutMs, () => {
      const error = new Error('Request timeout')
      error.name = 'TimeoutError'
      request.destroy(error)
    })
    request.on('error', rejectPromise)
    if (options.body) request.write(options.body)
    request.end()
  })
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function remainingTimeoutMs(deadlineAt, capMs) {
  return Math.max(1_000, Math.min(capMs, Math.max(0, deadlineAt - Date.now())))
}

async function runHealthCheck(healthUrl, healthTimeoutMs) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  try {
    const response = await requestJson(healthUrl, {
      timeoutMs: healthTimeoutMs,
    })
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      startedAt,
      commit: response.body?.commit || response.body?.git_sha || null,
      body: response.body,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      elapsedMs: Date.now() - started,
      startedAt,
      commit: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function startJob({ jobsUrl, brandUrl, provider, apiKey, deadlineAt, jobStartTimeoutMs }) {
  const payload = { brand_url: brandUrl }
  if (provider) payload.provider = provider
  if (apiKey) payload.api_key = apiKey

  const ownerId = 'guest:smoke-test'
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  headers['X-Insight-User'] = ownerId

  const response = await requestJson(jobsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    timeoutMs: remainingTimeoutMs(deadlineAt, jobStartTimeoutMs),
  })

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: response.body,
      via: 'job_start_http',
    }
  }

  if (!response.body?.job_id) {
    return {
      ok: false,
      status: response.status,
      via: 'job_start_invalid',
      body: {
        ...response.body,
        stage: 'job_start',
        error: {
          status_code: 500,
          detail: 'Discovery job start response missing job_id',
          retryable: false,
        },
      },
    }
  }

  return {
    ok: true,
    status: response.status,
    body: response.body,
    jobId: response.body.job_id,
    ownerId,
    pollIntervalMs: Number(response.body.retry_after_sec || 0) > 0
      ? Number(response.body.retry_after_sec) * 1000
      : DEFAULTS.pollIntervalMs,
  }
}

async function pollJob({
  baseUrl,
  jobId,
  ownerId,
  apiKey,
  deadlineAt,
  pollIntervalMs,
  pollRequestTimeoutMs,
  pollTransientErrorLimit,
}) {
  const pollUrl = `${baseUrl}/discovery/jobs/${jobId}`
  let transientErrors = 0
  const headers = {}
  if (apiKey) headers['X-API-Key'] = apiKey
  if (ownerId) headers['X-Insight-User'] = ownerId
  let lastSnapshot = {
    status: 'queued',
    stage: 'queued',
    progressPct: 0,
    message: '',
  }

  while (Date.now() < deadlineAt) {
    try {
      const response = await requestJson(pollUrl, {
        headers,
        timeoutMs: remainingTimeoutMs(deadlineAt, pollRequestTimeoutMs),
      })

      if (!response.ok) {
        return {
          ok: false,
          via: 'job_poll_http',
          status: response.status,
          body: response.body,
          lastSnapshot,
        }
      }

      transientErrors = 0
      const body = response.body || {}
      lastSnapshot = {
        status: body.status || lastSnapshot.status,
        stage: body.stage || lastSnapshot.stage,
        progressPct: body.progress_pct ?? lastSnapshot.progressPct,
        message: body.message || lastSnapshot.message,
      }

      if (body.status === 'completed') {
        if (!body.result) {
          return {
            ok: false,
            via: 'job_terminal',
            status: response.status,
            body: {
              ...body,
              error: {
                status_code: 500,
                detail: 'Discovery job completed without result payload',
                retryable: false,
              },
            },
            lastSnapshot,
          }
        }
        return {
          ok: true,
          via: 'job_terminal',
          status: response.status,
          body,
          lastSnapshot,
        }
      }

      if (body.status === 'failed' || body.status === 'cancelled') {
        return {
          ok: false,
          via: 'job_terminal',
          status: response.status,
          body,
          lastSnapshot,
        }
      }
    } catch (error) {
      transientErrors += 1
      if (transientErrors > pollTransientErrorLimit) {
        return {
          ok: false,
          via: 'job_poll_error',
          status: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error',
          error,
          lastSnapshot,
        }
      }
    }

    const sleepMs = Math.min(pollIntervalMs, Math.max(0, deadlineAt - Date.now()))
    if (sleepMs <= 0) break
    await sleep(sleepMs)
  }

  return {
    ok: false,
    via: 'job_poll_timeout',
    status: 'timeout',
    body: {
      stage: lastSnapshot.stage || 'unknown',
      error: {
        status_code: 504,
        detail: 'Discovery job polling timed out before terminal state',
        retryable: true,
      },
    },
    lastSnapshot,
  }
}

async function runAttempt({
  baseUrl,
  jobsUrl,
  brandUrl,
  provider,
  apiKey,
  timeoutMs,
  attempt,
  jobStartTimeoutMs,
  pollRequestTimeoutMs,
  pollIntervalMs,
  pollTransientErrorLimit,
}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const deadlineAt = started + timeoutMs

  let startResult
  try {
    startResult = await startJob({
      jobsUrl,
      brandUrl,
      provider,
      apiKey,
      deadlineAt,
      jobStartTimeoutMs,
    })
  } catch (error) {
    const classified = classifyFailure(0, { detail: error instanceof Error ? error.message : String(error) }, 'job_start')
    return {
      attempt,
      startedAt,
      elapsedMs: Date.now() - started,
      status: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error',
      ok: false,
      stage: classified.stage,
      failureClass: classified.failureClass,
      message: classified.detail.slice(0, 240),
      reportPresent: false,
      fetchedSites: null,
      analyzedCount: null,
      jobId: null,
      progressPct: 0,
      startStatus: null,
      terminalStatus: null,
      via: 'job_start_error',
    }
  }

  if (!startResult.ok) {
    const classified = classifyFailure(startResult.status, startResult.body, 'job_start')
    return {
      attempt,
      startedAt,
      elapsedMs: Date.now() - started,
      status: startResult.status,
      ok: false,
      stage: classified.stage,
      failureClass: classified.failureClass,
      message: classified.detail.slice(0, 240),
      reportPresent: false,
      fetchedSites: null,
      analyzedCount: null,
      jobId: startResult.body?.job_id || null,
      progressPct: startResult.body?.progress_pct ?? 0,
      startStatus: startResult.status,
      terminalStatus: startResult.body?.status || null,
      via: startResult.via,
    }
  }

  const pollResult = await pollJob({
    baseUrl,
    jobId: startResult.jobId,
    ownerId: startResult.ownerId,
    apiKey,
    deadlineAt,
    pollIntervalMs: startResult.pollIntervalMs || pollIntervalMs,
    pollRequestTimeoutMs,
    pollTransientErrorLimit,
  })

  const elapsedMs = Date.now() - started
  if (pollResult.ok) {
    const result = pollResult.body.result || {}
    return {
      attempt,
      startedAt,
      elapsedMs,
      status: pollResult.status,
      ok: true,
      stage: 'complete',
      failureClass: '-',
      message: 'report generated',
      reportPresent: Boolean(result.report_md || result.report),
      fetchedSites: Array.isArray(result.fetched_sites) ? result.fetched_sites.length : null,
      analyzedCount: result.analyzed_count ?? null,
      jobId: startResult.jobId,
      progressPct: pollResult.lastSnapshot?.progressPct ?? 100,
      startStatus: startResult.status,
      terminalStatus: pollResult.body.status || 'completed',
      via: pollResult.via,
    }
  }

  if (pollResult.via === 'job_poll_error') {
    const classified = classifyFailure(
      pollResult.status === 'timeout' ? 504 : 0,
      {
        stage: pollResult.lastSnapshot?.stage || 'unknown',
        detail: pollResult.error instanceof Error ? pollResult.error.message : String(pollResult.error),
      },
      pollResult.lastSnapshot?.stage || 'unknown'
    )
    return {
      attempt,
      startedAt,
      elapsedMs,
      status: pollResult.status,
      ok: false,
      stage: classified.stage,
      failureClass: classified.failureClass,
      message: classified.detail.slice(0, 240),
      reportPresent: false,
      fetchedSites: null,
      analyzedCount: null,
      jobId: startResult.jobId,
      progressPct: pollResult.lastSnapshot?.progressPct ?? 0,
      startStatus: startResult.status,
      terminalStatus: pollResult.lastSnapshot?.status || null,
      via: pollResult.via,
    }
  }

  const classified = classifyFailure(
    pollResult.status,
    pollResult.body,
    pollResult.lastSnapshot?.stage || 'unknown'
  )
  return {
    attempt,
    startedAt,
    elapsedMs,
    status: pollResult.status,
    ok: false,
    stage: classified.stage,
    failureClass: classified.failureClass,
    message: classified.detail.slice(0, 240),
    reportPresent: false,
    fetchedSites: null,
    analyzedCount: null,
    jobId: startResult.jobId,
    progressPct: pollResult.lastSnapshot?.progressPct ?? 0,
    startStatus: startResult.status,
    terminalStatus: pollResult.body?.status || pollResult.lastSnapshot?.status || null,
    via: pollResult.via,
  }
}

function summarizeResults(results) {
  const successes = results.filter((item) => item.ok)
  const failures = results.filter((item) => !item.ok)
  const groups = {}

  for (const failure of failures) {
    const key = `via=${failure.via} stage=${failure.stage} class=${failure.failureClass}`
    groups[key] = (groups[key] || 0) + 1
  }

  return {
    attempts: results.length,
    successCount: successes.length,
    failureCount: failures.length,
    successRate: results.length ? Number((successes.length / results.length).toFixed(3)) : 0,
    groups,
    sslTlsCount: failures.filter((item) => item.failureClass === 'SSL/TLS').length,
    timeoutCount: failures.filter((item) => item.failureClass.includes('timeout')).length,
    upstream502Count: failures.filter((item) => item.failureClass === 'upstream_502').length,
    analyze503Count: failures.filter((item) => item.failureClass === 'provider_503').length,
    genericTransportCount: failures.filter((item) => item.failureClass === 'frontend_regression').length,
  }
}

function evaluateExitReason({ health, summary, minSuccessCount, minSuccessRate }) {
  if (!health.ok) return 'health check failed'
  if (summary.attempts === 0) return null
  if (summary.successCount === 0) return 'no async discovery attempts completed successfully'
  if (minSuccessCount > 0 && summary.successCount < minSuccessCount) {
    return `success count ${summary.successCount}/${summary.attempts} is below required minimum ${minSuccessCount}`
  }
  if (minSuccessRate > 0 && summary.successRate < minSuccessRate) {
    return `success rate ${(summary.successRate * 100).toFixed(0)}% is below required minimum ${(minSuccessRate * 100).toFixed(0)}%`
  }
  return null
}

function formatSeconds(elapsedMs) {
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

function printSummary({ config, health, results, summary, outPath, exitReason }) {
  console.log('=== Discovery Async Rollout Check ===')
  console.log(`Started: ${jstTimestamp()} JST`)
  console.log(`Mode: ${config.mode}`)
  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Health URL: ${config.healthUrl}`)
  console.log(`Jobs URL: ${config.jobsUrl}`)
  console.log(`Brand URL: ${config.brandUrl}`)
  console.log(`Attempts: ${config.attempts}`)
  console.log(`Provider: ${config.provider || '<server default>'}`)
  console.log(`API key source: ${config.apiKeySource || '<not sent>'}`)
  console.log(`Min success count: ${config.minSuccessCount}`)
  console.log(`Min success rate: ${(config.minSuccessRate * 100).toFixed(0)}%`)
  console.log(`Artifact: ${outPath}`)
  console.log('')

  if (health.ok) {
    console.log(
      `[health] ok status=${health.status} elapsed=${formatSeconds(health.elapsedMs)} commit=${health.commit || 'unknown'}`
    )
  } else {
    console.log(
      `[health] fail status=${health.status} elapsed=${formatSeconds(health.elapsedMs)} detail=${health.error || detailFromBody(health.body)}`
    )
  }
  console.log('')

  if (results.length === 0) {
    console.log('No async job attempts requested.')
    return
  }

  for (const result of results) {
    const statusLabel = result.ok ? 'OK' : 'FAIL'
    console.log(
      `[${statusLabel}] #${result.attempt} start=${result.startStatus ?? '-'} terminal=${result.terminalStatus ?? '-'} status=${result.status} via=${result.via} stage=${result.stage} class=${result.failureClass} elapsed=${formatSeconds(result.elapsedMs)}`
    )
    console.log(`  job_id=${result.jobId || '-'} progress=${result.progressPct ?? '-'}%`)
    if (result.ok) {
      console.log(
        `  report=${result.reportPresent} fetched_sites=${result.fetchedSites ?? '-'} analyzed_count=${result.analyzedCount ?? '-'}`
      )
    } else {
      console.log(`  message=${result.message}`)
    }
  }

  console.log('')
  console.log('| # | Timestamp (JST) | Start | Terminal | Stage | Class | Elapsed | Result |')
  console.log('|---|-----------------|-------|----------|-------|-------|---------|--------|')
  for (const result of results) {
    console.log(
      `| ${result.attempt} | ${new Date(result.startedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })} | ${result.startStatus ?? '-'} | ${result.terminalStatus ?? '-'} | ${result.stage} | ${result.failureClass} | ${formatSeconds(result.elapsedMs)} | ${result.ok ? 'OK' : 'FAIL'} |`
    )
  }

  console.log('')
  console.log(`Success: ${summary.successCount}/${summary.attempts} (${(summary.successRate * 100).toFixed(0)}%)`)
  console.log(`Failure: ${summary.failureCount}/${summary.attempts} (${((summary.failureCount / Math.max(summary.attempts, 1)) * 100).toFixed(0)}%)`)

  if (summary.failureCount > 0) {
    console.log('')
    console.log('Failure breakdown:')
    for (const [group, count] of Object.entries(summary.groups)) {
      console.log(`  ${group}: ${count}`)
    }
  }

  if (exitReason) {
    console.log('')
    console.log(`Exit status: FAIL (${exitReason})`)
  } else {
    console.log('')
    console.log('Exit status: OK')
  }
}

async function main() {
  loadEnvFiles()

  const rawArgs = parseArgs(process.argv.slice(2))
  const mode = rawArgs.mode === 'proxy' ? 'proxy' : 'render'
  const attempts = Math.max(0, Math.trunc(parseNumber(rawArgs.attempts, DEFAULTS.attempts)))
  const pauseMs = Math.max(0, Math.trunc(parseNumber(rawArgs['pause-ms'], DEFAULTS.pauseMs)))
  const timeoutMs = Math.max(1_000, Math.trunc(parseNumber(rawArgs['timeout-ms'], DEFAULTS.timeoutMs)))
  const healthTimeoutMs = Math.max(
    1_000,
    Math.trunc(parseNumber(rawArgs['health-timeout-ms'], DEFAULTS.healthTimeoutMs))
  )
  const jobStartTimeoutMs = Math.max(
    1_000,
    Math.trunc(parseNumber(rawArgs['job-start-timeout-ms'], DEFAULTS.jobStartTimeoutMs))
  )
  const pollRequestTimeoutMs = Math.max(
    1_000,
    Math.trunc(parseNumber(rawArgs['poll-timeout-ms'], DEFAULTS.pollRequestTimeoutMs))
  )
  const pollIntervalMs = Math.max(
    250,
    Math.trunc(parseNumber(rawArgs['poll-interval-ms'], DEFAULTS.pollIntervalMs))
  )
  const pollTransientErrorLimit = Math.max(
    0,
    Math.trunc(parseNumber(rawArgs['poll-transient-error-limit'], DEFAULTS.pollTransientErrorLimit))
  )
  const minSuccessCount = Math.max(
    0,
    Math.trunc(parseNumber(rawArgs['min-success-count'], DEFAULTS.minSuccessCount))
  )
  const minSuccessRate = Math.max(
    0,
    Math.min(1, parseNumber(rawArgs['min-success-rate'], DEFAULTS.minSuccessRate))
  )
  const provider = resolveProvider()
  const apiKey = resolveApiKey(provider)
  const urls = buildUrls(mode, rawArgs['base-url'])

  const config = {
    mode,
    baseUrl: urls.baseUrl,
    healthUrl: urls.healthUrl,
    jobsUrl: urls.jobsUrl,
    brandUrl: rawArgs['brand-url'] || DEFAULTS.brandUrl,
    attempts,
    timeoutMs,
    pauseMs,
    jobStartTimeoutMs,
    pollRequestTimeoutMs,
    pollIntervalMs,
    pollTransientErrorLimit,
    minSuccessCount,
    minSuccessRate,
    provider,
    apiKeySource: apiKey.source,
    label: rawArgs.label || DEFAULTS.label,
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(
    process.cwd(),
    rawArgs.out || `.tmp-discovery-rollout/${timestamp}-${sanitizeSlug(config.label)}-${config.mode}.json`
  )

  const health = await runHealthCheck(config.healthUrl, healthTimeoutMs)

  const results = []
  if (health.ok) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await runAttempt({
        baseUrl: config.baseUrl,
        jobsUrl: config.jobsUrl,
        brandUrl: config.brandUrl,
        provider: config.provider,
        apiKey: apiKey.value,
        timeoutMs: config.timeoutMs,
        attempt,
        jobStartTimeoutMs: config.jobStartTimeoutMs,
        pollRequestTimeoutMs: config.pollRequestTimeoutMs,
        pollIntervalMs: config.pollIntervalMs,
        pollTransientErrorLimit: config.pollTransientErrorLimit,
      })
      results.push(result)
      if (attempt < attempts && pauseMs > 0) {
        await sleep(pauseMs)
      }
    }
  }

  const summary = summarizeResults(results)
  const exitReason = evaluateExitReason({
    health,
    summary,
    minSuccessCount: config.minSuccessCount,
    minSuccessRate: config.minSuccessRate,
  })
  const artifact = {
    generatedAt: new Date().toISOString(),
    generatedAtJst: jstTimestamp(),
    flow: 'async_jobs',
    config,
    health,
    summary,
    exitReason,
    results,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(artifact, null, 2))
  printSummary({ config, health, results, summary, outPath, exitReason })

  if (exitReason) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('[fatal]', error)
  process.exit(1)
})
