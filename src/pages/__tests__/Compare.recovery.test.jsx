import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// ── Auth helpers ──────────────────────────────────────────────
function setClaudeKey() {
  localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')
}

function renderCompare() {
  return render(<Compare />, { wrapper: TestProviders })
}

// ── Setup / teardown ─────────────────────────────────────────
beforeEach(() => {})
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// Helper: fill URLs and click scan
async function fillAndScan() {
  const user = userEvent.setup()
  const inputs = screen.getAllByRole('textbox')
  await user.type(inputs[0], 'https://example.com')
  await user.type(inputs[1], 'https://competitor.com')
  await user.click(screen.getByRole('button', { name: /分析開始/ }))
  return user
}

// ═══════════════════════════════════════════════════════════════
// New async-job error scenarios
// ═══════════════════════════════════════════════════════════════

describe('Compare — async job error scenarios', () => {
  it('shows error when startScanJob returns a network error', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan/jobs', () => {
        return HttpResponse.error()
      }),
    )

    renderCompare()
    await fillAndScan()

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )

    // The error banner should contain a retry button
    const retryButton = screen.getByRole('button', { name: /再試行/ })
    expect(retryButton).toBeInTheDocument()
  })

  it('shows error when poll returns a failed job status', async () => {
    setClaudeKey()

    // Job creation succeeds, but polling returns failed status
    server.use(
      http.get('/api/ml/scan/jobs/:jobId', () =>
        HttpResponse.json({
          status: 'failed',
          stage: 'analyzing',
          error: {
            detail: 'LLM分析エラー: モデルの応答が不正です',
            retryable: true,
          },
        }),
      ),
    )

    renderCompare()
    await fillAndScan()

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )
  })

  it('shows error when startScanJob returns 500 server error', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { error: 'Internal server error' },
          { status: 500 },
        ),
      ),
    )

    renderCompare()
    await fillAndScan()

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )
  })
})

describe('Compare — retry after error', () => {
  it('clears error state when retry button is clicked', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan/jobs', () =>
        HttpResponse.json(
          { error: '分析に失敗しました。しばらく待って再試行してください。' },
          { status: 500 },
        ),
      ),
    )

    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://example.com')
    await user.type(inputs[1], 'https://competitor.com')
    await user.click(screen.getByRole('button', { name: /分析開始/ }))

    // Wait for error
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )

    // Click retry — this calls clearRun('compare') which resets the run state
    const retryButton = screen.getByRole('button', { name: /再試行/ })
    await user.click(retryButton)

    // Error alert should be gone
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // The analysis button should be available again
    expect(screen.getByRole('button', { name: /分析開始/ })).toBeInTheDocument()
  }, 15000)
})

describe('Compare — poll result contains error status with report_md fallback', () => {
  it('extracts error message from report_md when error field is empty in poll result', async () => {
    setClaudeKey()

    // Poll returns completed but the result has error status + report_md
    server.use(
      http.get('/api/ml/scan/jobs/:jobId', () =>
        HttpResponse.json({
          status: 'completed',
          stage: 'complete',
          progress_pct: 100,
          updated_at: new Date().toISOString(),
          result: {
            status: 'error',
            error: '',
            report_md: 'LLM分析エラー: トークン上限に達しました',
          },
        }),
      ),
    )

    renderCompare()
    await fillAndScan()

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )

    expect(screen.getByText(/LLM分析エラー: トークン上限に達しました/)).toBeInTheDocument()
  })
})

describe('Compare — sessionStorage resume on mount', () => {
  it('resumes a previous job from sessionStorage on mount', async () => {
    setClaudeKey()

    // Simulate an active job in sessionStorage from a previous page visit
    sessionStorage.setItem(
      'is-compare-active-scan-job',
      JSON.stringify({
        jobId: 'scan-resume-001',
        pollUrl: '/scan/jobs/scan-resume-001',
        urls: {
          target: 'https://saved-target.com',
          compA: 'https://saved-comp.com',
          compB: '',
        },
        startedAt: Date.now(),
      }),
    )

    // Poll immediately returns completed
    server.use(
      http.get('/api/ml/scan/jobs/scan-resume-001', () =>
        HttpResponse.json({
          status: 'completed',
          stage: 'complete',
          progress_pct: 100,
          updated_at: new Date().toISOString(),
          result: {
            run_id: 'scan-resume-001',
            overall_score: 91,
            scores: {},
            report_md: '# Resumed Report',
          },
        }),
      ),
    )

    renderCompare()

    // Score from resumed result should appear
    await waitFor(
      () => {
        const matches = screen.getAllByText('91')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 10000 },
    )
  })

  it('ignores expired jobs in sessionStorage (startedAt older than hard ceiling)', () => {
    setClaudeKey()

    // SCAN_POLL_HARD_CEILING_MS = 660_000 (11 min) in Compare.jsx
    sessionStorage.setItem(
      'is-compare-active-scan-job',
      JSON.stringify({
        jobId: 'scan-expired-001',
        pollUrl: '/scan/jobs/scan-expired-001',
        urls: { target: 'https://old.com', compA: '', compB: '' },
        startedAt: Date.now() - 661_000,
      }),
    )

    renderCompare()

    // Component should render normally without entering loading state
    expect(screen.getByRole('button', { name: /分析開始/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Session key should have been cleared (getActiveScanJob returns null for expired)
    expect(sessionStorage.getItem('is-compare-active-scan-job')).toBeNull()
  })
})
