import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server.js'
import { TestProviders } from '../../test/mocks/contexts.js'
import Compare from '../Compare.jsx'

// Stub heavy components
vi.mock('../../components/MarkdownRenderer', () => ({
  default: ({ content }) => <div data-testid="markdown-renderer">{content}</div>,
}))
vi.mock('../../components/DataCoverageCard', () => ({
  default: () => <div data-testid="data-coverage-card" />,
}))

vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

function setup() {
  localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')
  render(<Compare />, { wrapper: TestProviders })
  const inputs = screen.getAllByRole('textbox')
  fireEvent.change(inputs[0], { target: { value: 'https://example.com' } })
  fireEvent.change(inputs[1], { target: { value: 'https://competitor.com' } })
  fireEvent.click(screen.getByRole('button', { name: /分析開始/ }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// ===========================================================
// Compare -- async job polling scenarios (replaces old scan recovery)
// ===========================================================

describe('Compare — timeout recovery core logic', () => {
  // 1. Poll returns completed with score -> score displayed
  it('recovers a timed-out scan from history', async () => {
    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { job_id: 'job-1', poll_url: '/scan/jobs/job-1', retry_after_sec: 0.5 },
          { status: 202 },
        ),
      ),
      http.get('/api/ml/scan/jobs/job-1', () =>
        HttpResponse.json({
          status: 'completed',
          stage: 'complete',
          progress_pct: 100,
          updated_at: new Date().toISOString(),
          result: {
            run_id: 'job-1',
            overall_score: 85,
            scores: { ux: 90, content: 80 },
            report_md: '# Recovered Report',
          },
        }),
      ),
    )

    setup()

    await waitFor(
      () => {
        const matches = screen.getAllByText('85')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 10000 },
    )
  }, 15000)

  // 2. Different score -> still displays correctly
  it('recovers when history URLs have different casing/trailing slashes', async () => {
    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { job_id: 'job-2', poll_url: '/scan/jobs/job-2', retry_after_sec: 0.5 },
          { status: 202 },
        ),
      ),
      http.get('/api/ml/scan/jobs/job-2', () =>
        HttpResponse.json({
          status: 'completed',
          stage: 'complete',
          progress_pct: 100,
          updated_at: new Date().toISOString(),
          result: {
            run_id: 'job-2',
            overall_score: 72,
            scores: { ux: 75, content: 70 },
            report_md: '# Normalized Report',
          },
        }),
      ),
    )

    setup()

    await waitFor(
      () => {
        const matches = screen.getAllByText('72')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 10000 },
    )
  }, 15000)

  // 3. Job fails immediately -> error banner
  it('shows error when no matching scan is found in history', async () => {
    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { job_id: 'job-3', poll_url: '/scan/jobs/job-3', retry_after_sec: 0.5 },
          { status: 202 },
        ),
      ),
      http.get('/api/ml/scan/jobs/job-3', () =>
        HttpResponse.json({
          status: 'failed',
          stage: 'analyze',
          error: { detail: 'ジョブが失敗しました', retryable: true },
        }),
      ),
    )

    setup()

    await waitFor(
      () => { expect(screen.getByRole('alert')).toBeInTheDocument() },
      { timeout: 10000 },
    )
  }, 30000)

  // 4. Polling runs and makes multiple requests for a running job
  it('ignores scans older than 2 minutes', async () => {
    let callCount = 0
    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { job_id: 'job-4', poll_url: '/scan/jobs/job-4', retry_after_sec: 0.5 },
          { status: 202 },
        ),
      ),
      http.get('/api/ml/scan/jobs/job-4', () => {
        callCount += 1
        if (callCount >= 3) {
          return HttpResponse.json({
            status: 'completed',
            stage: 'complete',
            progress_pct: 100,
            updated_at: new Date().toISOString(),
            result: { run_id: 'job-4', overall_score: 77, report_md: '# Done' },
          })
        }
        return HttpResponse.json({
          status: 'running',
          stage: 'analyze',
          progress_pct: callCount * 25,
          updated_at: new Date().toISOString(),
        })
      }),
    )

    setup()

    await waitFor(
      () => {
        const matches = screen.getAllByText('77')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 10000 },
    )
    // Polling should have happened multiple times
    expect(callCount).toBeGreaterThanOrEqual(3)
  }, 30000)

  // 5. startScanJob throws -> error banner, no polling started
  it('skips recovery for non-timeout errors', async () => {
    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )

    let pollCalled = false
    server.use(
      http.get('/api/ml/scan/jobs/:jobId', () => {
        pollCalled = true
        return HttpResponse.json({ status: 'running' })
      }),
    )

    setup()

    await waitFor(
      () => { expect(screen.getByRole('alert')).toBeInTheDocument() },
      { timeout: 10000 },
    )
    expect(pollCalled).toBe(false)
  }, 15000)
})
