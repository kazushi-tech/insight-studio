import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicReportShare from '../PublicReportShare'

const hoisted = vi.hoisted(() => ({ fetchShare: vi.fn() }))

vi.mock('../../api/projectReports', () => ({
  fetchPublicReportShare: hoisted.fetchShare,
}))

const report = {
  schema_version: 'report.v2',
  scope: { current_period: { start: '2026-07-01', end: '2026-07-31' } },
  availability: { overall: 'full' },
  metrics: [],
  conclusions: [{ title: '訪問が増えています', body: '根拠を確認しました' }],
  actions: [],
  evidence: [],
  caveats: [],
  generated_at: '2026-08-01T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/report-shares/public-token']}>
      <Routes>
        <Route path="report-shares/:token" element={<PublicReportShare />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicReportShare', () => {
  beforeEach(() => {
    hoisted.fetchShare.mockReset()
  })

  it('loads without auth and reinforces noindex/no-store metadata', async () => {
    hoisted.fetchShare.mockResolvedValue({
      share: {
        title: 'GA4 Web成果レポート',
        summary: 'BigQuery datasetのまとめ',
        report,
        expires_at: '2026-08-08T00:00:00Z',
      },
    })

    const { container } = renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: /Web成果レポート/ })).toBeInTheDocument()
    expect(hoisted.fetchShare).toHaveBeenCalledWith('public-token')
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/GA4|BigQuery|dataset/i)
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex,nofollow,noarchive',
    )
    expect(document.head.querySelector('meta[http-equiv="Cache-Control"]')).toHaveAttribute(
      'content',
      'no-store, max-age=0',
    )
  })

  it('shows a safe expired-link state without backend detail', async () => {
    hoisted.fetchShare.mockRejectedValue({
      status: 410,
      body: { detail: 'report_share_expired SQL SELECT secret' },
    })

    const { container } = renderPage()

    expect(await screen.findByRole('heading', { name: 'この共有リンクは利用できません' })).toBeInTheDocument()
    await waitFor(() => expect(container.textContent).not.toMatch(/SQL|SELECT|secret|report_share_expired/i))
  })
})
