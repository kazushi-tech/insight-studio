import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../../test/mocks/server.js'
import { TestProviders } from '../../test/mocks/contexts.js'
import Compare from '../Compare.jsx'

// Stub heavy markdown / chart components to avoid pulling in remark/recharts etc.
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

// ── Helpers ───────────────────────────────────────────────────
function renderCompare() {
  return render(<Compare />, { wrapper: TestProviders })
}

// ── Setup / teardown ─────────────────────────────────────────
beforeEach(() => {
  // Make warmMarketLensBackend resolve immediately via the health handler
  // (already handled by default MSW handlers)
})
afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// ═══════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════

describe('Compare — basic rendering', () => {
  it('renders three URL inputs and the analysis button', () => {
    setClaudeKey()
    renderCompare()

    // Three input fields (target, compA, compB)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThanOrEqual(3)

    // The analysis button
    expect(screen.getByRole('button', { name: /分析開始/ })).toBeInTheDocument()
  })

  it('renders the page heading', () => {
    renderCompare()
    expect(screen.getByText('LP比較・競合分析')).toBeInTheDocument()
  })

  it('shows a warning when no Claude API key is set', () => {
    // Do NOT call setClaudeKey()
    renderCompare()
    expect(screen.getByText(/Claude API キーが必要です/)).toBeInTheDocument()
  })
})

describe('Compare — URL input interaction', () => {
  it('allows typing URLs into all three fields', async () => {
    setClaudeKey()
    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    // inputs[0]=target, [1]=compA, [2]=compB
    await user.type(inputs[0], 'https://my-site.jp')
    await user.type(inputs[1], 'https://comp-a.com')
    await user.type(inputs[2], 'https://comp-b.com')

    expect(inputs[0]).toHaveValue('https://my-site.jp')
    expect(inputs[1]).toHaveValue('https://comp-a.com')
    expect(inputs[2]).toHaveValue('https://comp-b.com')
  })
})

describe('Compare — happy path scan', () => {
  it('enters loading state when scan button is clicked (delayed response)', async () => {
    setClaudeKey()

    // Delay the scan response indefinitely so the loading state persists
    server.use(
      http.post('/api/ml/scan', async () => {
        await delay('infinite')
      }),
    )

    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://example.com')
    await user.type(inputs[1], 'https://competitor.com')

    const button = screen.getByRole('button', { name: /分析開始/ })
    expect(button).not.toBeDisabled()

    // Use fireEvent instead of userEvent to avoid waiting for async handlers
    fireEvent.click(button)

    // The text "分析中…" appears in both the button and the MetaBand status badge
    await waitFor(() => {
      const matches = screen.getAllByText('分析中…')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows results after a successful scan', async () => {
    setClaudeKey()
    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://example.com')
    await user.type(inputs[1], 'https://competitor.com')

    await user.click(screen.getByRole('button', { name: /分析開始/ }))

    // Wait for the overall score "78" to appear (from fixture).
    // Score may appear in multiple places (overall + individual score card).
    await waitFor(
      () => {
        const matches = screen.getAllByText('78')
        expect(matches.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 12000 },
    )

    // Markdown report is rendered
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()

    // MetaBand should show completed status
    expect(screen.getByText('完了')).toBeInTheDocument()
  }, 15000)
})

describe('Compare — error display', () => {
  it('shows error on 401 auth failure', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )

    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://example.com')
    await user.type(inputs[1], 'https://competitor.com')

    await user.click(screen.getByRole('button', { name: /分析開始/ }))

    // Wait for error banner (role="alert")
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )
  })

  it('shows error on 429 rate limit', async () => {
    setClaudeKey()

    server.use(
      http.post('/api/ml/scan', () =>
        HttpResponse.json({ error: 'Rate limited' }, { status: 429 }),
      ),
    )

    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://example.com')
    await user.type(inputs[1], 'https://competitor.com')

    await user.click(screen.getByRole('button', { name: /分析開始/ }))

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      },
      { timeout: 10000 },
    )
  })

  it('shows auth error when no API key is configured', async () => {
    // Do NOT call setClaudeKey() — analysisKey will be empty
    renderCompare()
    // Button is disabled because hasAnalysisKey is false
    const button = screen.getByRole('button', { name: /分析開始/ })
    expect(button).toBeDisabled()
  })
})

describe('Compare — draft persistence', () => {
  it('restores URLs from sessionStorage draft on mount', () => {
    setClaudeKey()

    const draft = {
      urls: {
        target: 'https://saved-target.com',
        compA: 'https://saved-comp-a.com',
        compB: 'https://saved-comp-b.com',
      },
    }
    sessionStorage.setItem('is-draft-compare', JSON.stringify(draft))

    renderCompare()

    const inputs = screen.getAllByRole('textbox')
    expect(inputs[0]).toHaveValue('https://saved-target.com')
    expect(inputs[1]).toHaveValue('https://saved-comp-a.com')
    expect(inputs[2]).toHaveValue('https://saved-comp-b.com')
  })

  it('persists typed URLs to sessionStorage', async () => {
    setClaudeKey()
    renderCompare()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'https://typed.com')

    const raw = sessionStorage.getItem('is-draft-compare')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.urls.target).toBe('https://typed.com')
  })
})
