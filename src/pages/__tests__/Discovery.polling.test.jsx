import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
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

// Mock the API module — each test overrides the mock return values.
vi.mock('../../api/marketLens', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    warmMarketLensBackend: vi.fn().mockResolvedValue(true),
    startDiscoveryJob: vi.fn().mockResolvedValue({
      job_id: 'test-job-001',
      stage: 'queued',
      poll_url: '/discovery/jobs/test-job-001',
      retry_after_sec: 2,
      status: 'running',
    }),
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
  getDiscoveryJob,
  warmMarketLensBackend,
} from '../../api/marketLens'

// Suppress noisy console output from the component during tests
vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

/**
 * Render Discovery, fill URL via fireEvent, and click submit.
 * Uses fireEvent (not userEvent) for simplicity with fake timers.
 * After this call, handleDiscover is pending — flush with act + advanceTimersByTimeAsync.
 */
function renderAndSubmit() {
  render(<Discovery />, { wrapper: TestProviders })
  const input = screen.getByPlaceholderText('競合他社のURLを入力')
  fireEvent.change(input, { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /競合を発見/ }))
}

// ═══════════════════════════════════════════════════════════════
// Discovery — Polling core logic
// ═══════════════════════════════════════════════════════════════

describe('Discovery — polling core logic', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('is_claude_key', 'sk-ant-test-key-for-testing')

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
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  // ── 1. Happy Path ポーリング → 完了 ─────────────────────────
  it('polls until completed and displays the report', async () => {
    let callCount = 0
    getDiscoveryJob.mockImplementation(() => {
      callCount += 1
      if (callCount < 3) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 50 + callCount * 10,
          updated_at: new Date(Date.now() + callCount * 1000).toISOString(),
        })
      }
      return Promise.resolve({
        status: 'completed',
        stage: 'complete',
        progress_pct: 100,
        updated_at: new Date().toISOString(),
        result: {
          report_md: '# Discovery Report\n\nThis is the test report.',
          fetched_sites: [],
        },
      })
    })

    renderAndSubmit()

    // Flush handleSubmit chain + advance through 3 polling cycles (2s each)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000)
    })

    expect(screen.getByText(/Discovery Report/)).toBeInTheDocument()
    expect(getDiscoveryJob).toHaveBeenCalledTimes(3)
  }, 15000)

  // ── 2. Stale 検知（45秒 heartbeat 無変更 → タイムアウト）────
  it('detects stale job when updated_at does not change for 45s', async () => {
    const fixedTimestamp = '2026-01-01T00:00:00.000Z'
    getDiscoveryJob.mockResolvedValue({
      status: 'running',
      stage: 'analyze',
      progress_pct: 50,
      updated_at: fixedTimestamp,
    })

    renderAndSubmit()

    // Advance past stale timeout (45s) — staleStart is set at 2nd poll (~T+4s),
    // so stale triggers when Date.now() - staleStart > 45s → ~T+50s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(52000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/応答しなくなりました/)).toBeInTheDocument()
  }, 15000)

  // ── 3. Stale リセット（updated_at 変化でカウンターリセット）──
  it('resets stale counter when updated_at changes', async () => {
    let callCount = 0
    getDiscoveryJob.mockImplementation(() => {
      callCount += 1
      // Calls 1-10: same updated_at (staleStart set at call 2)
      if (callCount <= 10) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 50,
          updated_at: '2026-01-01T00:00:00.000Z',
        })
      }
      // Call 11: updated_at changes → staleStart resets
      if (callCount === 11) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 60,
          updated_at: '2026-01-01T00:00:42.000Z',
        })
      }
      // Calls 12-19: same new updated_at
      if (callCount < 20) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 70,
          updated_at: '2026-01-01T00:00:42.000Z',
        })
      }
      // Call 20: completed
      return Promise.resolve({
        status: 'completed',
        stage: 'complete',
        progress_pct: 100,
        updated_at: new Date().toISOString(),
        result: {
          report_md: '# Stale Reset Report',
          fetched_sites: [],
        },
      })
    })

    renderAndSubmit()

    // Advance ~56s — enough for 20 polls (15*2s + 5*5s = 55s)
    // Without reset: staleStart at T+4s → stale at T+49s (before completion)
    // With reset: staleStart resets at call 11 → no stale before completion
    await act(async () => {
      await vi.advanceTimersByTimeAsync(58000)
    })

    // Should show report (no stale error)
    expect(screen.getByText(/Stale Reset Report/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }, 30000)

  // ── 4. Hard Ceiling（180秒 → 強制タイムアウト）───────────────
  it('triggers hard ceiling timeout after 180s', async () => {
    getDiscoveryJob.mockImplementation(() => {
      return Promise.resolve({
        status: 'running',
        stage: 'analyze',
        progress_pct: 50,
        // Always changing updated_at to prevent stale detection
        updated_at: new Date(Date.now()).toISOString(),
      })
    })

    renderAndSubmit()

    // Advance past 180s hard ceiling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(185000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/タイムアウトしました/)).toBeInTheDocument()
  }, 30000)

  // ── 5. ネットワークエラー 3回連続 → ハードフェイル ────────────
  it('fails after 3 consecutive network errors', async () => {
    let callCount = 0
    getDiscoveryJob.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.resolve({
          status: 'running',
          stage: 'queued',
          progress_pct: 10,
          updated_at: new Date().toISOString(),
        })
      }
      return Promise.reject(new TypeError('Failed to fetch'))
    })

    renderAndSubmit()

    // Poll 1 (T+2s): success → error count = 0
    // Poll 2 (T+4s): fail → error count = 1
    // Poll 3 (T+6s): fail → error count = 2
    // Poll 4 (T+8s): fail → error count = 3 → hard fail
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(callCount).toBe(4)
  }, 15000)

  // ── 6. ネットワークエラー 2回 + 成功 → 継続 ──────────────────
  it('resets error counter when a successful poll follows network errors', async () => {
    let callCount = 0
    getDiscoveryJob.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.resolve({
          status: 'running',
          stage: 'queued',
          progress_pct: 10,
          updated_at: new Date(Date.now() + 1000).toISOString(),
        })
      }
      if (callCount === 2 || callCount === 3) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      if (callCount === 4) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 60,
          updated_at: new Date(Date.now() + 4000).toISOString(),
        })
      }
      return Promise.resolve({
        status: 'completed',
        stage: 'complete',
        progress_pct: 100,
        updated_at: new Date().toISOString(),
        result: {
          report_md: '# Recovery Success',
          fetched_sites: [],
        },
      })
    })

    renderAndSubmit()

    // Advance through 5 polls (5*2s = 10s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000)
    })

    expect(screen.getByText(/Recovery Success/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }, 15000)

  // ── 7. Adaptive Interval（2秒 → 30秒経過後 5秒に切り替え）───
  it('switches from 2s to 5s polling interval after 30s', async () => {
    getDiscoveryJob.mockImplementation(() => {
      return Promise.resolve({
        status: 'running',
        stage: 'analyze',
        progress_pct: 50,
        updated_at: new Date(Date.now()).toISOString(),
      })
    })

    renderAndSubmit()

    // Phase 1: advance 10s — at 2s interval expect ~5 polls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    const callsIn10s = getDiscoveryJob.mock.calls.length

    // Phase 2: advance to T+35s, let interval switch happen at 30s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25000)
    })
    const callsAt35s = getDiscoveryJob.mock.calls.length

    // Phase 3: measure poll rate in the slow interval (T+35s to T+50s = 15s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    const callsAt50s = getDiscoveryJob.mock.calls.length

    const earlyRate = callsIn10s // ~5 calls in 10s (2s interval)
    const lateCallsDuring15s = callsAt50s - callsAt35s // ~3 calls in 15s (5s interval)

    // Early rate (2s) should produce more calls per unit time than late rate (5s)
    expect(earlyRate).toBeGreaterThanOrEqual(4)
    expect(lateCallsDuring15s).toBeLessThanOrEqual(4)
    expect(earlyRate).toBeGreaterThan(lateCallsDuring15s)
  }, 30000)

  // ── 8. サーバー retry_after_sec の尊重 ───────────────────────
  it('respects retry_after_sec from the server response', async () => {
    let callCount = 0
    getDiscoveryJob.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return Promise.resolve({
          status: 'running',
          stage: 'analyze',
          progress_pct: 50,
          updated_at: new Date(Date.now()).toISOString(),
          retry_after_sec: 10,
        })
      }
      return Promise.resolve({
        status: 'completed',
        stage: 'complete',
        progress_pct: 100,
        updated_at: new Date().toISOString(),
        result: {
          report_md: '# Retry After Report',
          fetched_sites: [],
        },
      })
    })

    renderAndSubmit()

    // First poll fires at T+2s (initial interval)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(getDiscoveryJob).toHaveBeenCalledTimes(1)

    // At T+5s: should NOT have fired second poll (retry_after_sec=10 → next at T+12s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(getDiscoveryJob).toHaveBeenCalledTimes(1)

    // At T+13s: second poll should have fired
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(getDiscoveryJob).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Retry After Report/)).toBeInTheDocument()
  }, 15000)

  // ── 9. Session Recovery（マウント時にセッション復旧）──────────
  it('resumes polling from sessionStorage on mount', async () => {
    getDiscoveryJob.mockResolvedValue({
      status: 'completed',
      stage: 'complete',
      progress_pct: 100,
      updated_at: new Date().toISOString(),
      result: {
        report_md: '# Recovered Session Report',
        fetched_sites: [],
      },
    })

    // Set active job in sessionStorage BEFORE render
    sessionStorage.setItem(
      'is-discovery-active-job',
      JSON.stringify({
        jobId: 'job-recovered-1',
        pollUrl: '/discovery/jobs/job-recovered-1',
        url: 'https://example.com',
        startedAt: Date.now(),
      }),
    )

    render(<Discovery />, { wrapper: TestProviders })

    // Advance timer for the resume-on-mount poll to fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(screen.getByText(/Recovered Session Report/)).toBeInTheDocument()
    expect(getDiscoveryJob).toHaveBeenCalledWith('/discovery/jobs/job-recovered-1')
  }, 15000)

  // ── 10. 期限切れセッションは無視（180秒超過）─────────────────
  it('ignores expired sessions (older than 180s)', async () => {
    getDiscoveryJob.mockResolvedValue({
      status: 'completed',
      stage: 'complete',
      progress_pct: 100,
      updated_at: new Date().toISOString(),
      result: {
        report_md: '# Should not appear',
        fetched_sites: [],
      },
    })

    // Set expired active job (startedAt more than 180s ago)
    sessionStorage.setItem(
      'is-discovery-active-job',
      JSON.stringify({
        jobId: 'job-expired-1',
        pollUrl: '/discovery/jobs/job-expired-1',
        url: 'https://example.com',
        startedAt: Date.now() - 181_000,
      }),
    )

    render(<Discovery />, { wrapper: TestProviders })

    // Advance some time — should NOT trigger a poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // getDiscoveryJob should NOT have been called for the expired session
    expect(getDiscoveryJob).not.toHaveBeenCalled()
    expect(screen.queryByText(/Should not appear/)).not.toBeInTheDocument()
  }, 15000)

  // ── 11. ウォームアップがタイムアウトした場合のエラー表示 ────────
  it('shows timeout error when warmup hangs beyond 60s', async () => {
    // warmMarketLensBackend を永続的に pending な Promise に設定
    warmMarketLensBackend.mockReturnValue(new Promise(() => {}))

    renderAndSubmit()

    // 60秒進行 → PRE_POLL_TIMEOUT_MS 発動
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByText(/タイムアウト/).length).toBeGreaterThan(0)
  }, 15000)

  // ── 12. ジョブ作成がタイムアウトした場合のエラー表示 ────────────
  it('shows timeout error when job creation hangs beyond 60s', async () => {
    // warmup は成功するが、startDiscoveryJob が永続的に pending
    warmMarketLensBackend.mockResolvedValue(true)
    startDiscoveryJob.mockReturnValue(new Promise(() => {}))

    renderAndSubmit()

    // 60秒進行 → PRE_POLL_TIMEOUT_MS 発動
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61000)
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByText(/タイムアウト/).length).toBeGreaterThan(0)
  }, 15000)

  // ── 13. ナビゲーション復帰レジューム（主バグのテスト）────────
  it('resumes polling when navigating back while loading', async () => {
    // 1. sessionStorage にアクティブジョブを設定
    sessionStorage.setItem('is-discovery-active-job', JSON.stringify({
      jobId: 'job-nav-1',
      pollUrl: '/discovery/jobs/job-nav-1',
      url: 'https://example.com',
      startedAt: Date.now(),
    }))

    // getDiscoveryJob は running を返す
    getDiscoveryJob.mockResolvedValue({
      status: 'running',
      stage: 'search',
      progress_pct: 50,
      updated_at: new Date().toISOString(),
    })

    // 2. 初回マウント — loading状態でもレジュームされる
    render(<Discovery />, { wrapper: TestProviders })

    // 3. ポーリングが開始されることを確認
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(getDiscoveryJob).toHaveBeenCalledWith('/discovery/jobs/job-nav-1')
  }, 15000)

  // ── 14. ステージ別タイムアウト検知 ────────────────────────────
  it('detects stage-level timeout when a stage exceeds its limit', async () => {
    // brand_fetch ステージで65s停止（limit=60s）
    // mockImplementation で毎回新しい updated_at を返して stale 検知を回避
    getDiscoveryJob.mockImplementation(() => {
      return Promise.resolve({
        status: 'running',
        stage: 'brand_fetch',
        progress_pct: 20,
        updated_at: new Date(Date.now()).toISOString(),
      })
    })

    renderAndSubmit()

    // brand_fetch タイムアウト (60s) を超過 — stage starts at T+2s, next tick at T+67s
    await act(async () => { await vi.advanceTimersByTimeAsync(70000) })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByText(/タイムアウト/).length).toBeGreaterThan(0)
  }, 15000)
})
