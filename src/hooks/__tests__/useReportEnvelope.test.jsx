import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useReportEnvelope } from '../useReportEnvelope'

vi.mock('../../api/marketLens', () => ({
  getScanReportEnvelope: vi.fn(),
  getDiscoveryReportEnvelope: vi.fn(),
}))

import { getScanReportEnvelope, getDiscoveryReportEnvelope } from '../../api/marketLens'

describe('useReportEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty state when kind or id is missing', () => {
    const { result } = renderHook(() => useReportEnvelope(null, null))
    expect(result.current.envelope).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getScanReportEnvelope).not.toHaveBeenCalled()
    expect(getDiscoveryReportEnvelope).not.toHaveBeenCalled()
  })

  it('fetches envelope for scan kind', async () => {
    const envelope = { version: 'v0', report_id: 'abc', kind: 'scan', priority_actions: [] }
    getScanReportEnvelope.mockResolvedValueOnce(envelope)

    const { result } = renderHook(() => useReportEnvelope('scan', 'abc'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.envelope).toEqual(envelope)
    expect(result.current.error).toBeNull()
    expect(getScanReportEnvelope).toHaveBeenCalledWith('abc')
    expect(getDiscoveryReportEnvelope).not.toHaveBeenCalled()
  })

  it('fetches envelope for discovery kind', async () => {
    const envelope = { version: 'v0', report_id: 'job-1', kind: 'discovery', priority_actions: [] }
    getDiscoveryReportEnvelope.mockResolvedValueOnce(envelope)

    const { result } = renderHook(() => useReportEnvelope('discovery', 'job-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.envelope).toEqual(envelope)
    expect(getDiscoveryReportEnvelope).toHaveBeenCalledWith('job-1')
  })

  it('silently falls back on 404 (flag off)', async () => {
    const err = new Error('Not found')
    err.status = 404
    getScanReportEnvelope.mockRejectedValueOnce(err)

    const { result } = renderHook(() => useReportEnvelope('scan', 'abc'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.envelope).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('silently falls back on 409 (job not ready)', async () => {
    const err = new Error('Not ready')
    err.status = 409
    getDiscoveryReportEnvelope.mockRejectedValueOnce(err)

    const { result } = renderHook(() => useReportEnvelope('discovery', 'job-x'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.envelope).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('surfaces other errors via error field', async () => {
    const err = new Error('Server boom')
    err.status = 500
    getScanReportEnvelope.mockRejectedValueOnce(err)

    const { result } = renderHook(() => useReportEnvelope('scan', 'abc'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.envelope).toBeNull()
    expect(result.current.error).toBe(err)
  })

  it('refetches when id changes', async () => {
    getScanReportEnvelope.mockResolvedValueOnce({ report_id: '1' })
    getScanReportEnvelope.mockResolvedValueOnce({ report_id: '2' })

    const { result, rerender } = renderHook(({ id }) => useReportEnvelope('scan', id), {
      initialProps: { id: '1' },
    })

    await waitFor(() => expect(result.current.envelope?.report_id).toBe('1'))

    rerender({ id: '2' })
    await waitFor(() => expect(result.current.envelope?.report_id).toBe('2'))

    expect(getScanReportEnvelope).toHaveBeenCalledTimes(2)
  })
})
