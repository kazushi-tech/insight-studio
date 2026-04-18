import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// msw server/http available via setup.js; import here only when needed per-test
import { TestProviders } from '../../test/mocks/contexts.js'
import Discovery from '../Discovery.jsx'

// Chart.js relies on <canvas> which jsdom does not support fully.
// Mock the entire module to prevent runtime errors during rendering.
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
    RadarController: {},
    RadialLinearScale: {},
    PointElement: {},
    LineElement: {},
    Filler: {},
  }
})

// Suppress noisy console output from the component during tests
vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('Discovery — happy path & basic rendering', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // ── 1. Renders input and button ─────────────────────────
  it('renders URL input and the discovery button', () => {
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    expect(input).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /競合を発見/ })
    expect(button).toBeInTheDocument()
  })

  // ── 2. URL input works ──────────────────────────────────
  it('allows the user to type a URL into the input', async () => {
    const user = userEvent.setup()
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    await user.type(input, 'https://example.com')

    expect(input).toHaveValue('https://example.com')
  })

  // ── 3. Shows warning when no API key ────────────────────
  it('shows a warning message when no Claude API key is configured', () => {
    // localStorage is empty → hasAnalysisKey = false
    render(<Discovery />, { wrapper: TestProviders })

    expect(
      screen.getByText(/Claude API キーが必要です/)
    ).toBeInTheDocument()
  })

  // ── 4. Button is disabled when no API key ───────────────
  it('disables the submit button when no API key is set', async () => {
    const user = userEvent.setup()
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    await user.type(input, 'https://example.com')

    const button = screen.getByRole('button', { name: /競合を発見/ })
    expect(button).toBeDisabled()
  })

  // ── 5. Button is enabled when API key is set and URL is typed ──
  it('enables the submit button when a valid API key is set and URL is typed', async () => {
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')
    const user = userEvent.setup()
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    await user.type(input, 'https://example.com')

    const button = screen.getByRole('button', { name: /競合を発見/ })
    expect(button).toBeEnabled()
  })

  // ── 6. No API-key warning is hidden when key is present ─
  it('hides the API key warning when a valid key is configured', () => {
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')
    render(<Discovery />, { wrapper: TestProviders })

    expect(screen.queryByText(/Claude API キーが必要です/)).not.toBeInTheDocument()
  })

  // ── 7. Shows loading state after clicking discover button ─
  it('enters loading state after clicking the discover button', async () => {
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')

    // warmMarketLensBackend makes a health check. The default MSW handler
    // returns { status: 'ok' } for /api/ml/health.  After warm-up the
    // component POSTs to /api/ml/discovery/jobs (also handled by MSW).
    const user = userEvent.setup()
    render(<Discovery />, { wrapper: TestProviders })

    const input = screen.getByPlaceholderText('競合他社のURLを入力')
    await user.type(input, 'https://example.com')

    const button = screen.getByRole('button', { name: /競合を発見/ })
    await user.click(button)

    // After clicking, the component should enter a loading / running state.
    // The button text changes to a stage label (e.g. "サーバー起動待ち…" or "検索中…")
    // and a LoadingSpinner with role="status" appears.
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  // ── 8. Displays heading and description ─────────────────
  it('renders the page heading and description', () => {
    render(<Discovery />, { wrapper: TestProviders })

    expect(screen.getByText('Discovery Hub')).toBeInTheDocument()
    expect(
      screen.getByText(/URLを入力するだけで/)
    ).toBeInTheDocument()
  })

  // ── 9. Shows backend status indicator ───────────────────
  it('shows a backend status indicator', () => {
    render(<Discovery />, { wrapper: TestProviders })

    // The component always renders one of: "サーバー準備完了", "サーバー起動中…", "サーバー状態確認中"
    const statusText = screen.getByText(
      /サーバー準備完了|サーバー起動中|サーバー状態確認中/
    )
    expect(statusText).toBeInTheDocument()
  })
})
