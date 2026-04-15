import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// msw used via vi.mock, not direct server overrides
import { TestProviders } from '../../test/mocks/contexts.js'
import Discovery from '../Discovery.jsx'

// Chart.js relies on <canvas> which jsdom does not support fully.
vi.mock('chart.js', () => {
  class FakeChart {
    constructor() {}
    destroy() {}
    update() {}
  }
  FakeChart.register = () => {}
  return {
    Chart: FakeChart,
    BarController: {},
    BarElement: {},
    CategoryScale: {},
    LinearScale: {},
    Tooltip: {},
    Legend: {},
  }
})

// Mock the API module to bypass internal retry/sleep delays that would
// cause test timeouts.  Each test overrides the mock return values.
vi.mock('../../api/marketLens', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // warmMarketLensBackend defaults to success; tests can override
    warmMarketLensBackend: vi.fn().mockResolvedValue(true),
    // startDiscoveryJob defaults to success; tests override for errors
    startDiscoveryJob: vi.fn().mockResolvedValue({
      job_id: 'test-job-001',
      stage: 'queued',
      poll_url: '/discovery/jobs/test-job-001',
      retry_after_sec: 2,
      status: 'running',
    }),
    // getDiscoveryJob keeps its default behaviour via MSW
    getDiscoveryJob: vi.fn().mockResolvedValue({
      status: 'running',
      stage: 'queued',
      progress_pct: 10,
      updated_at: new Date().toISOString(),
    }),
    // classifyError stays real for accurate error categorisation
    classifyError: actual.classifyError,
  }
})

import {
  startDiscoveryJob,
  warmMarketLensBackend,
} from '../../api/marketLens'

// Suppress noisy console output from the component during tests
vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

/**
 * Helper: render Discovery with a valid API key and a URL already typed,
 * then click the discover button.
 */
async function renderAndClickDiscover() {
  const user = userEvent.setup()
  render(<Discovery />, { wrapper: TestProviders })

  const input = screen.getByPlaceholderText('競合他社のURLを入力')
  await user.type(input, 'https://example.com')

  const button = screen.getByRole('button', { name: /競合を発見/ })
  await user.click(button)

  return user
}

describe('Discovery — error scenarios', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Set a valid Claude API key so that the component proceeds past the
    // auth guard and actually hits the network.
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')

    // Restore default mock implementations (mockReset: true in vitest config
    // clears them between tests).
    warmMarketLensBackend.mockResolvedValue(true)
    startDiscoveryJob.mockResolvedValue({
      job_id: 'test-job-001',
      stage: 'queued',
      poll_url: '/discovery/jobs/test-job-001',
      retry_after_sec: 2,
      status: 'running',
    })
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // ── 1. Cold start / 503 error ───────────────────────────
  it('shows error UI when the backend returns 503 (cold start)', async () => {
    const error503 = new Error('サーバーが起動中です')
    error503.status = 503
    startDiscoveryJob.mockRejectedValueOnce(error503)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    // A retry button should be present inside the error banner
    expect(screen.getByRole('button', { name: /再試行/ })).toBeInTheDocument()
  })

  // ── 2. Network error ────────────────────────────────────
  it('shows error UI on network failure', async () => {
    const networkError = new TypeError('Failed to fetch')
    startDiscoveryJob.mockRejectedValueOnce(networkError)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  // ── 3. Auth error (401) ─────────────────────────────────
  it('shows error UI when the backend returns 401 (unauthorized)', async () => {
    const error401 = new Error('Invalid API key')
    error401.status = 401
    startDiscoveryJob.mockRejectedValueOnce(error401)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  // ── 4. Rate limit (429) ─────────────────────────────────
  it('shows error UI when the backend returns 429 (rate limit)', async () => {
    const error429 = new Error('Rate limit exceeded. Please try again later.')
    error429.status = 429
    startDiscoveryJob.mockRejectedValueOnce(error429)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  // ── 5. Warm-up failure ──────────────────────────────────
  it('shows error when backend warm-up fails', async () => {
    // Use mockResolvedValue (not Once) because the component also calls
    // warmMarketLensBackend() on mount, which would consume a Once mock.
    warmMarketLensBackend.mockResolvedValue(false)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    // Should mention server startup failure
    expect(screen.getByText(/サーバー起動に失敗しました/)).toBeInTheDocument()
  })

  // ── 6. Missing API key / provider triggers disabled button ──
  it('shows warning and disables button when no API key is configured', async () => {
    localStorage.removeItem('is_claude_key')

    const user = userEvent.setup()
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    await user.type(input, 'https://example.com')

    expect(screen.getByText(/Claude API キーが必要です/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /競合を発見/ })
    expect(button).toBeDisabled()
  })

  // ── 7. Retry button clears error and returns to idle ────
  it('clears the error state when the retry button is clicked', async () => {
    const error503 = new Error('Service unavailable')
    error503.status = 503
    startDiscoveryJob.mockRejectedValueOnce(error503)

    await renderAndClickDiscover()

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    // Click retry — this calls handleRetry which clears the run
    const retryButton = screen.getByRole('button', { name: /再試行/ })
    const user = userEvent.setup()
    await user.click(retryButton)

    // After retry, the error banner should disappear
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // The discover button should be visible again
    expect(screen.getByRole('button', { name: /競合を発見/ })).toBeInTheDocument()
  })

  // ── 8. Error banner shows the error message text ────────
  it('displays the error message text in the error banner', async () => {
    const error = new Error('カスタムエラーメッセージ')
    error.status = 500
    startDiscoveryJob.mockRejectedValueOnce(error)

    await renderAndClickDiscover()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.getByText('カスタムエラーメッセージ')).toBeInTheDocument()
  })
})
