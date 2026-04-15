import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server.js'
import {
  classifyError,
  warmMarketLensBackend,
  startDiscoveryJob,
  getDiscoveryJob,
  scan,
  getScans,
  getScan,
  health,
} from '../../api/marketLens.js'

// ─── classifyError ─────────────────────────────────────────────

describe('classifyError', () => {
  // -- null / undefined --
  it('returns unknown for null error', () => {
    const result = classifyError(null)
    expect(result.category).toBe('unknown')
    expect(result.retryable).toBe(true)
  })

  it('returns unknown for undefined error', () => {
    const result = classifyError(undefined)
    expect(result.category).toBe('unknown')
    expect(result.retryable).toBe(true)
  })

  // -- Timeout / AbortError --
  it('classifies error with isTimeout flag as timeout', () => {
    const err = new Error('something')
    err.isTimeout = true
    const result = classifyError(err)
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('classifies AbortError as timeout', () => {
    const err = new DOMException('The operation was aborted', 'AbortError')
    const result = classifyError(err)
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "timeout" as timeout', () => {
    const result = classifyError(new Error('Request timeout after 30s'))
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "タイムアウト" as timeout', () => {
    const result = classifyError(new Error('リクエストがタイムアウトしました'))
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  // -- Cold start (503) --
  it('classifies status 503 as cold_start', () => {
    const err = new Error('Service Unavailable')
    err.status = 503
    const result = classifyError(err)
    expect(result.category).toBe('cold_start')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "起動中" as cold_start', () => {
    const result = classifyError(new Error('バックエンドが起動中です'))
    expect(result.category).toBe('cold_start')
    expect(result.retryable).toBe(true)
  })

  // -- Network / CORS --
  it('classifies TypeError without status as network error', () => {
    const err = new TypeError('Failed to fetch')
    const result = classifyError(err)
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "cors" as network error', () => {
    const err = new Error('CORS policy blocked')
    const result = classifyError(err)
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "failed to fetch" as network error', () => {
    const err = new Error('Failed to fetch resource')
    const result = classifyError(err)
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "接続できませんでした" as network error', () => {
    const err = new Error('バックエンドに接続できませんでした')
    const result = classifyError(err)
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  // -- Auth error (401, 403) --
  it('classifies status 401 as auth_error', () => {
    const err = new Error('Unauthorized')
    err.status = 401
    const result = classifyError(err)
    expect(result.category).toBe('auth_error')
    expect(result.retryable).toBe(false)
  })

  it('classifies status 403 as auth_error', () => {
    const err = new Error('Forbidden')
    err.status = 403
    const result = classifyError(err)
    expect(result.category).toBe('auth_error')
    expect(result.retryable).toBe(false)
  })

  // -- Not found (404) --
  it('classifies status 404 as not_found', () => {
    const err = new Error('Not Found')
    err.status = 404
    const result = classifyError(err)
    expect(result.category).toBe('not_found')
    expect(result.retryable).toBe(false)
  })

  // -- LLM output parse errors (upstream, retryable) --
  it('classifies "llm output parse" message as upstream (retryable)', () => {
    const err = new Error('LLM output parse error occurred')
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  it('classifies "json parse error" message as upstream (retryable)', () => {
    const err = new Error('json parse error in response')
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  it('classifies "output validation failed" message as upstream (retryable)', () => {
    const err = new Error('output validation failed for response')
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  // -- LLM parse error takes priority over 422 status --
  it('classifies LLM parse error even with status 422', () => {
    const err = new Error('LLM output parse error')
    err.status = 422
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  // -- Invalid input (422, 400) --
  it('classifies status 422 as invalid_input', () => {
    const err = new Error('Unprocessable Entity')
    err.status = 422
    const result = classifyError(err)
    expect(result.category).toBe('invalid_input')
    expect(result.retryable).toBe(false)
  })

  it('classifies status 400 as invalid_input', () => {
    const err = new Error('Bad Request')
    err.status = 400
    const result = classifyError(err)
    expect(result.category).toBe('invalid_input')
    expect(result.retryable).toBe(false)
  })

  // -- Rate limit (429) --
  it('classifies status 429 as rate_limit', () => {
    const err = new Error('Too Many Requests')
    err.status = 429
    const result = classifyError(err)
    expect(result.category).toBe('rate_limit')
    expect(result.retryable).toBe(true)
  })

  // -- Overloaded (529, or message includes "overloaded") --
  it('classifies status 529 as overloaded', () => {
    const err = new Error('Service overloaded')
    err.status = 529
    const result = classifyError(err)
    expect(result.category).toBe('overloaded')
    expect(result.retryable).toBe(true)
  })

  it('classifies message containing "overloaded" as overloaded', () => {
    const err = new Error('The API is overloaded right now')
    const result = classifyError(err)
    expect(result.category).toBe('overloaded')
    expect(result.retryable).toBe(true)
  })

  // -- Upstream server error (500, 502) --
  it('classifies status 500 as upstream', () => {
    const err = new Error('Internal Server Error')
    err.status = 500
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  it('classifies status 502 as upstream', () => {
    const err = new Error('Bad Gateway')
    err.status = 502
    const result = classifyError(err)
    expect(result.category).toBe('upstream')
    expect(result.retryable).toBe(true)
  })

  // -- Unknown / generic fallback --
  it('returns unknown for unrecognized error', () => {
    const err = new Error('Something completely unexpected')
    err.status = 999
    const result = classifyError(err)
    expect(result.category).toBe('unknown')
    expect(result.retryable).toBe(true)
  })

  // -- Verify all results have the expected shape --
  it('always returns category, label, guidance, and retryable', () => {
    const testCases = [
      null,
      new Error('timeout'),
      (() => { const e = new Error('x'); e.status = 503; return e })(),
      new TypeError('Failed to fetch'),
      (() => { const e = new Error('x'); e.status = 401; return e })(),
      (() => { const e = new Error('x'); e.status = 404; return e })(),
      new Error('llm output parse'),
      (() => { const e = new Error('x'); e.status = 422; return e })(),
      (() => { const e = new Error('x'); e.status = 429; return e })(),
      (() => { const e = new Error('x'); e.status = 529; return e })(),
      (() => { const e = new Error('x'); e.status = 500; return e })(),
      new Error('unknown thing'),
    ]
    for (const tc of testCases) {
      const result = classifyError(tc)
      expect(result).toHaveProperty('category')
      expect(result).toHaveProperty('label')
      expect(result).toHaveProperty('guidance')
      expect(result).toHaveProperty('retryable')
      expect(typeof result.category).toBe('string')
      expect(typeof result.label).toBe('string')
      expect(typeof result.guidance).toBe('string')
      expect(typeof result.retryable).toBe('boolean')
    }
  })
})

// ─── warmMarketLensBackend ─────────────────────────────────────

describe('warmMarketLensBackend', () => {
  it('resolves true in jsdom (localhost forces proxy mode)', async () => {
    // In jsdom, window.location.hostname === 'localhost'
    // so SHOULD_FORCE_PROXY is true and warmMarketLensBackend() returns true immediately
    const result = await warmMarketLensBackend()
    expect(result).toBe(true)
  })
})

// ─── startDiscoveryJob ─────────────────────────────────────────

describe('startDiscoveryJob', () => {
  it('returns job_id, stage, poll_url, retry_after_sec, and status on happy path', async () => {
    const result = await startDiscoveryJob('https://example.com')
    expect(result.job_id).toBe('test-job-001')
    expect(result.stage).toBe('queued')
    expect(result.status).toBe('running')
    // poll_url should be normalized to a relative path
    expect(result.poll_url).toBe('/discovery/jobs/test-job-001')
    expect(result.retry_after_sec).toBe(2)
  })

  it('passes api key and options in the request body', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/ml/discovery/jobs', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          job_id: 'test-job-002',
          stage: 'queued',
          poll_url: '/discovery/jobs/test-job-002',
          retry_after_sec: 3,
          status: 'running',
        })
      }),
    )

    await startDiscoveryJob('https://example.com', {
      apiKey: 'sk-test-key',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    })

    expect(capturedBody).toMatchObject({
      brand_url: 'https://example.com',
      api_key: 'sk-test-key',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    })
  })

  it('handles server errors', async () => {
    server.use(
      http.post('/api/ml/discovery/jobs', () =>
        HttpResponse.json({ detail: 'Bad Request' }, { status: 400 }),
      ),
    )

    await expect(startDiscoveryJob('https://example.com')).rejects.toThrow()
  })
})

// ─── getDiscoveryJob ───────────────────────────────────────────

describe('getDiscoveryJob', () => {
  it('returns job status on happy path', async () => {
    const result = await getDiscoveryJob('test-job-001')
    expect(result.status).toBe('completed')
    expect(result.stage).toBe('complete')
    expect(result.progress_pct).toBe(100)
    expect(result.result).toBeDefined()
    expect(result.result.report_md).toBeDefined()
  })

  it('accepts a poll_url path', async () => {
    const result = await getDiscoveryJob('/discovery/jobs/test-job-001')
    expect(result.status).toBe('completed')
  })

  it('handles server errors', async () => {
    server.use(
      http.get('/api/ml/discovery/jobs/:jobId', () =>
        HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
      ),
    )

    await expect(getDiscoveryJob('nonexistent-job')).rejects.toThrow()
  })
})

// ─── scan ──────────────────────────────────────────────────────

describe('scan', () => {
  it('returns analysis results on happy path', async () => {
    const result = await scan(['https://example.com', 'https://competitor.com'])
    expect(result.run_id).toBe('scan-test-001')
    expect(result.status).toBe('completed')
    expect(result.overall_score).toBe(78)
    expect(result.scores).toBeDefined()
    expect(result.scores.ux).toBe(82)
    expect(result.report_md).toBeDefined()
    expect(result.extracted).toHaveLength(2)
  })

  it('passes api key as string option', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/ml/scan', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          run_id: 'scan-test-002',
          status: 'completed',
          overall_score: 80,
          scores: {},
          report_md: '# Report',
          extracted: [],
        })
      }),
    )

    await scan(['https://example.com'], 'sk-test-api-key')
    expect(capturedBody).toMatchObject({
      urls: ['https://example.com'],
      api_key: 'sk-test-api-key',
    })
  })

  it('passes options object with provider and model', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/ml/scan', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({
          run_id: 'scan-test-003',
          status: 'completed',
          overall_score: 85,
          scores: {},
          report_md: '# Report',
          extracted: [],
        })
      }),
    )

    await scan(['https://example.com'], { apiKey: 'sk-key', provider: 'anthropic', model: 'test-model' })
    expect(capturedBody).toMatchObject({
      urls: ['https://example.com'],
      api_key: 'sk-key',
      provider: 'anthropic',
      model: 'test-model',
    })
  })

  it('handles server errors', async () => {
    server.use(
      http.post('/api/ml/scan', () =>
        HttpResponse.json({ detail: 'Server Error' }, { status: 500 }),
      ),
    )

    await expect(scan(['https://example.com'])).rejects.toThrow()
  })
})

// ─── getScans ──────────────────────────────────────────────────

describe('getScans', () => {
  it('returns scan history (empty by default, filtered by tracked IDs)', async () => {
    // Default handler returns { scans: [] } — with no tracked scan IDs, result is filtered to empty
    const result = await getScans()
    // getScans filters by locally tracked scan IDs; with none tracked, returns empty or matches structure
    if (result?.scans) {
      expect(Array.isArray(result.scans)).toBe(true)
    } else {
      expect(Array.isArray(result)).toBe(true)
    }
  })

  it('returns untracked scans when includeUntracked is true', async () => {
    server.use(
      http.get('/api/ml/scans', () =>
        HttpResponse.json({
          scans: [
            { run_id: 'scan-untracked-1', status: 'completed' },
            { run_id: 'scan-untracked-2', status: 'completed' },
          ],
        }),
      ),
    )

    const result = await getScans({ includeUntracked: true })
    const scans = result?.scans ?? result
    expect(Array.isArray(scans)).toBe(true)
    expect(scans).toHaveLength(2)
  })
})

// ─── getScan ───────────────────────────────────────────────────

describe('getScan', () => {
  it('returns scan detail for a run ID', async () => {
    const result = await getScan('scan-test-001')
    expect(result.run_id).toBe('scan-test-001')
    expect(result.status).toBe('completed')
    expect(result.overall_score).toBe(78)
    expect(result.report_md).toBeDefined()
  })

  it('handles server errors', async () => {
    server.use(
      http.get('/api/ml/scans/:runId', () =>
        HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
      ),
    )

    await expect(getScan('nonexistent-run')).rejects.toThrow()
  })
})

// ─── health ────────────────────────────────────────────────────

describe('health', () => {
  it('returns health status', async () => {
    const result = await health()
    expect(result.status).toBe('ok')
  })

  it('handles server errors', async () => {
    server.use(
      http.get('/api/ml/health', () =>
        HttpResponse.json({ status: 'error' }, { status: 500 }),
      ),
    )

    await expect(health()).rejects.toThrow()
  })
})
