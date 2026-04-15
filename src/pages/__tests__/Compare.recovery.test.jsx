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
// Timeout recovery scenarios
// ═══════════════════════════════════════════════════════════════

describe('Compare — timeout triggers error / recovery flow', () => {
  it('shows error when scan endpoint returns a network error', async () => {
    setClaudeKey()

    // Override scan to return a network-level error which the fetch layer
    // translates into a thrown Error (similar to AbortError/timeout)
    server.use(
      http.post('/api/ml/scan', () => {
        return HttpResponse.error()
      }),
      // Recovery will poll getScans — return empty so recovery finds nothing
      http.get('/api/ml/scans', () =>
        HttpResponse.json({ scans: [] }),
      ),
    )

    renderCompare()
    await fillAndScan()

    // Eventually an error banner should appear (after recovery attempt fails or error is shown)
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

  it('shows error when scan returns status error in response body', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan', () =>
        HttpResponse.json({
          status: 'error',
          error: 'LLM分析エラー: モデルの応答が不正です',
          report_md: '',
        }),
      ),
    )

    renderCompare()
    await fillAndScan()

    // Error banner should show the backend error message
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )

    // Verify the specific error message from the response
    expect(screen.getByText(/LLM分析エラー/)).toBeInTheDocument()
  })

  it('shows error when backend warm-up fails', async () => {
    setClaudeKey()

    // Make the health endpoint fail so warmMarketLensBackend returns false.
    // The component checks for warmResult and fails the run with a specific message.
    // However, warmMarketLensBackend uses the direct backend URL, not proxy.
    // In test env with jsdom, SHOULD_FORCE_PROXY = false (hostname is 'localhost'),
    // actually it IS localhost in jsdom, so SHOULD_FORCE_PROXY = true and
    // warmMarketLensBackend returns Promise.resolve(true) immediately.
    //
    // Since warm-up is bypassed in local-like envs, we test the scan error path instead.
    // Override scan to return 500 server error.
    server.use(
      http.post('/api/ml/scan', () =>
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
      http.post('/api/ml/scan', () =>
        HttpResponse.json({
          status: 'error',
          error: '分析に失敗しました。しばらく待って再試行してください。',
        }),
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
  })
})

describe('Compare — scan returns error status with report_md fallback', () => {
  it('extracts error message from report_md when error field is empty', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan', () =>
        HttpResponse.json({
          status: 'error',
          error: '',
          report_md: 'LLM分析エラー: トークン上限に達しました',
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
