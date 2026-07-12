import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportPrint from '../ReportPrint'

const hoisted = vi.hoisted(() => ({ getReport: vi.fn() }))

vi.mock('../../api/projectReports', () => ({
  getProjectReport: hoisted.getReport,
}))

const report = {
  schema_version: 'report.v2',
  scope: { current_period: { start: '2026-07-01', end: '2026-07-31' } },
  availability: { overall: 'full' },
  metrics: [],
  conclusions: [],
  actions: [],
  evidence: [],
  caveats: [],
  generated_at: '2026-08-01T00:00:00Z',
}

describe('ReportPrint', () => {
  beforeEach(() => {
    hoisted.getReport.mockReset()
    hoisted.getReport.mockResolvedValue({
      report: { title: 'Web成果レポート', summary: '今回のまとめ', report },
    })
  })

  it('renders a dedicated A4 document and invokes the browser print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { container } = render(
      <MemoryRouter initialEntries={['/projects/project-1/reports/report-1/print']}>
        <Routes>
          <Route path="projects/:projectRef/reports/:reportId/print" element={<ReportPrint />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Web成果レポート' })).toBeInTheDocument()
    expect(hoisted.getReport).toHaveBeenCalledWith('project-1', 'report-1')
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('style').textContent).toContain('size: A4 portrait')
    await userEvent.click(screen.getByRole('button', { name: /印刷・PDFとして保存/ }))
    expect(print).toHaveBeenCalledTimes(1)
  })
})
