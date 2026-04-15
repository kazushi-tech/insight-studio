import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server.js'
import {
  health,
  getDiscoveryJob,
  startDiscoveryJob,
  scan,
} from '../../api/marketLens.js'

// ═══════════════════════════════════════════════════════════════
// Transport layer tests — proxy path, error structure, retries
// ═══════════════════════════════════════════════════════════════

describe('Transport — proxy path routing', () => {
  // ── 1. プロキシパスが使用される確認 ────────────────────────────
  it('uses proxy path /api/ml/ for requests in jsdom', async () => {
    let capturedUrl = null
    server.use(
      http.get('/api/ml/health', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ status: 'ok' })
      }),
    )

    await health()

    // In jsdom, hostname is 'localhost' → SHOULD_FORCE_PROXY = true → /api/ml/ path
    expect(capturedUrl).toContain('/api/ml/health')
    // Should NOT contain the direct Render backend URL
    expect(capturedUrl).not.toContain('market-lens-ai.onrender.com')
  })
})

describe('Transport — HTTP error structure', () => {
  // ── 2. HTTP エラー時の Error オブジェクト構造 ──────────────────
  it('thrown error includes status and detail from response body', async () => {
    server.use(
      http.get('/api/ml/discovery/jobs/:jobId', () =>
        HttpResponse.json(
          { detail: 'custom error message from backend' },
          { status: 500 },
        ),
      ),
    )

    try {
      await getDiscoveryJob('xxx')
      // Should not reach here
      expect.unreachable('Expected getDiscoveryJob to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.status).toBe(500)
      expect(error.message).toContain('custom error message from backend')
    }
  })
})

describe('Transport — retry behavior', () => {
  // ── 3. startDiscoveryJob の 503 リトライ ──────────────────────
  it('retries startDiscoveryJob on 503 and succeeds on second attempt', async () => {
    let attemptCount = 0
    server.use(
      http.post('/api/ml/discovery/jobs', () => {
        attemptCount += 1
        if (attemptCount === 1) {
          return HttpResponse.json(
            { detail: 'Service Unavailable' },
            { status: 503 },
          )
        }
        return HttpResponse.json({
          job_id: 'retry-job-001',
          stage: 'queued',
          poll_url: '/discovery/jobs/retry-job-001',
          retry_after_sec: 2,
          status: 'running',
        })
      }),
    )

    const result = await startDiscoveryJob('https://example.com')

    expect(result.job_id).toBe('retry-job-001')
    expect(attemptCount).toBeGreaterThanOrEqual(2)
  }, 30000)

  // ── 4. scan のネットワークエラーリトライ ───────────────────────
  it('retries scan on network error and succeeds on second attempt', async () => {
    let attemptCount = 0
    server.use(
      http.post('/api/ml/scan', () => {
        attemptCount += 1
        if (attemptCount === 1) {
          return HttpResponse.error()
        }
        return HttpResponse.json({
          run_id: 'retry-scan-001',
          status: 'completed',
          overall_score: 90,
          scores: { ux: 85, content: 95 },
          report_md: '# Retried Report',
          extracted: [],
        })
      }),
    )

    const result = await scan(['https://example.com', 'https://competitor.com'])

    expect(result.run_id).toBe('retry-scan-001')
    expect(result.overall_score).toBe(90)
    expect(attemptCount).toBeGreaterThanOrEqual(2)
  }, 30000)
})
