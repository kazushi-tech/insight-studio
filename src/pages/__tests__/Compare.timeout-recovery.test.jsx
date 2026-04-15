import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TestProviders } from '../../test/mocks/contexts.js'
import Compare from '../Compare.jsx'

// Stub heavy markdown / chart components
vi.mock('../../components/MarkdownRenderer', () => ({
  default: ({ content }) => <div data-testid="markdown-renderer">{content}</div>,
}))
vi.mock('../../components/DataCoverageCard', () => ({
  default: () => <div data-testid="data-coverage-card" />,
}))

// Mock the API module — each test overrides mock return values.
vi.mock('../../api/marketLens', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    warmMarketLensBackend: vi.fn().mockResolvedValue(true),
    scan: vi.fn().mockRejectedValue(
      Object.assign(new Error('timeout'), { isTimeout: true, name: 'AbortError' }),
    ),
    getScans: vi.fn().mockResolvedValue({ scans: [] }),
    getScan: vi.fn().mockResolvedValue(null),
    // classifyError stays real for accurate categorization
    classifyError: actual.classifyError,
  }
})

import {
  warmMarketLensBackend,
  scan,
  getScans,
  getScan,
} from '../../api/marketLens'

// Suppress noisy console output
vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

/**
 * Render Compare, fill URLs via fireEvent, and click submit.
 * Uses fireEvent for simplicity with fake timers.
 */
function renderAndSubmit() {
  render(<Compare />, { wrapper: TestProviders })
  const inputs = screen.getAllByRole('textbox')
  fireEvent.change(inputs[0], { target: { value: 'https://example.com' } })
  fireEvent.change(inputs[1], { target: { value: 'https://competitor.com' } })
  fireEvent.click(screen.getByRole('button', { name: /分析開始/ }))
}

// ═══════════════════════════════════════════════════════════════
// Compare — timeout recovery core logic
// ═══════════════════════════════════════════════════════════════

describe('Compare — timeout recovery core logic', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')

    warmMarketLensBackend.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  // ── 1. タイムアウト → リカバリ成功 ────────────────────────────
  it('recovers a timed-out scan from history', async () => {
    const timeoutError = new Error('Request timeout')
    timeoutError.isTimeout = true
    timeoutError.name = 'AbortError'
    scan.mockRejectedValue(timeoutError)

    getScans.mockResolvedValue({
      scans: [{
        status: 'completed',
        urls: ['https://example.com', 'https://competitor.com'],
        created_at: new Date().toISOString(),
        run_id: 'recovered-1',
      }],
    })

    getScan.mockResolvedValue({
      run_id: 'recovered-1',
      status: 'completed',
      overall_score: 85,
      scores: { ux: 90, content: 80 },
      report_md: '# Recovered Report',
      extracted: [],
    })

    renderAndSubmit()

    // Flush microtasks: warmup → scan timeout → recovery finds match immediately
    // (no sleep needed since findMatchingCompletedScan succeeds on first attempt)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const matches = screen.getAllByText('85')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  }, 15000)

  // ── 2. URL正規化を経てリカバリ成功 ────────────────────────────
  it('recovers when history URLs have different casing/trailing slashes', async () => {
    const timeoutError = new Error('Request timeout')
    timeoutError.isTimeout = true
    timeoutError.name = 'AbortError'
    scan.mockRejectedValue(timeoutError)

    getScans.mockResolvedValue({
      scans: [{
        status: 'completed',
        urls: ['https://Example.COM/', 'https://Competitor.com/'],
        created_at: new Date().toISOString(),
        run_id: 'normalized-1',
      }],
    })

    getScan.mockResolvedValue({
      run_id: 'normalized-1',
      status: 'completed',
      overall_score: 72,
      scores: { ux: 75, content: 70 },
      report_md: '# Normalized Recovery',
      extracted: [],
    })

    renderAndSubmit()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const matches = screen.getAllByText('72')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  }, 15000)

  // ── 3. リカバリ失敗（マッチなし）→ エラー表示 ─────────────────
  it('shows error when no matching scan is found in history', async () => {
    const timeoutError = new Error('Request timeout')
    timeoutError.isTimeout = true
    timeoutError.name = 'AbortError'
    scan.mockRejectedValue(timeoutError)

    // No matching scans in history
    getScans.mockResolvedValue({ scans: [] })

    renderAndSubmit()

    // Advance through recovery timeout (90s default, polling every 5s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
  }, 30000)

  // ── 4. 2分以上前のスキャンは無視 ──────────────────────────────
  it('ignores scans older than 2 minutes', async () => {
    const timeoutError = new Error('Request timeout')
    timeoutError.isTimeout = true
    timeoutError.name = 'AbortError'
    scan.mockRejectedValue(timeoutError)

    // Scan created 3 minutes ago — should be filtered out by timestamp check
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    getScans.mockResolvedValue({
      scans: [{
        status: 'completed',
        urls: ['https://example.com', 'https://competitor.com'],
        created_at: threeMinAgo,
        run_id: 'old-scan-1',
      }],
    })

    renderAndSubmit()

    // Advance through full recovery timeout
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // getScan should NOT have been called because old scan was filtered
    expect(getScan).not.toHaveBeenCalled()
  }, 30000)

  // ── 5. timeout 以外のエラーではリカバリをスキップ ──────────────
  it('skips recovery for non-timeout errors', async () => {
    const authError = new Error('Unauthorized')
    authError.status = 401
    scan.mockRejectedValue(authError)

    renderAndSubmit()

    // Flush microtasks — error should appear immediately (no recovery)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // getScans should NOT have been called (no recovery attempt)
    expect(getScans).not.toHaveBeenCalled()
  }, 15000)
})
