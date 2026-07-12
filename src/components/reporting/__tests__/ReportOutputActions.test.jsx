import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportOutputActions from '../ReportOutputActions'

const report = { schema_version: 'report.v2', report_id: 'contract-1' }
const savedHistory = [{
  id: 'local-marker',
  serverReportId: 'server-1',
  reportBundle: { reportV2: report },
}]

function api(overrides = {}) {
  return {
    fetchProjectReportCsv: vi.fn().mockResolvedValue('label,value\n訪問,10\n'),
    createProjectReportShare: vi.fn().mockResolvedValue({
      share: {
        id: 'share-1',
        token: 'one-time-token',
        expires_at: '2026-08-08T00:00:00Z',
      },
    }),
    revokeProjectReportShare: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

describe('ReportOutputActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('shows export but not share creation to a viewer', () => {
    render(
      <ReportOutputActions
        projectRef="project-1"
        report={report}
        historyEntries={savedHistory}
        user={{ role: 'project_viewer' }}
        reportsApi={api()}
      />,
    )

    expect(screen.getByRole('link', { name: /印刷・PDF保存/ })).toHaveAttribute(
      'href',
      '/projects/project-1/reports/server-1/print',
    )
    expect(screen.getByRole('button', { name: /根拠数値CSV/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /共有リンクを発行/ })).not.toBeInTheDocument()
    expect(screen.getByText(/共有リンクの発行は契約管理者/)).toBeInTheDocument()
  })

  it('requires server history persistence before enabling any output', async () => {
    const onSaveReport = vi.fn().mockReturnValue({ id: 'local-entry' })
    render(
      <ReportOutputActions
        projectRef="project-1"
        report={report}
        historyEntries={[]}
        user={{ role: 'workspace_owner' }}
        onSaveReport={onSaveReport}
        reportsApi={api()}
      />,
    )

    expect(screen.queryByRole('link', { name: /印刷・PDF保存/ })).not.toBeInTheDocument()
    expect(screen.getByText(/先にこのレポートを履歴へ保存/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '履歴へ保存' }))
    expect(onSaveReport).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/履歴への保存を開始/)).toBeInTheDocument()
  })

  it('creates, copies, and revokes a seven-day owner share without storage writes', async () => {
    const reportsApi = api()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(
      <ReportOutputActions
        projectRef="project-1"
        report={report}
        historyEntries={savedHistory}
        user={{ workspace_role: 'workspace_admin' }}
        reportsApi={reportsApi}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '共有リンクを発行' }))
    const input = await screen.findByLabelText(/閲覧期限/)
    expect(input).toHaveValue(`${window.location.origin}/report-shares/one-time-token`)
    expect(reportsApi.createProjectReportShare).toHaveBeenCalledWith(
      'project-1',
      'server-1',
      { expiresInDays: 7 },
    )

    await userEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value)
    expect(setItem).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'リンクを失効' }))
    await waitFor(() => expect(screen.queryByLabelText(/閲覧期限/)).not.toBeInTheDocument())
    expect(reportsApi.revokeProjectReportShare).toHaveBeenCalledWith(
      'project-1',
      'server-1',
      'share-1',
    )
  })

  it('downloads the authenticated CSV without placing a token in the URL', async () => {
    const reportsApi = api()
    const createObjectURL = vi.fn().mockReturnValue('blob:report')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <ReportOutputActions
        projectRef="project-1"
        report={report}
        historyEntries={savedHistory}
        user={{ role: 'project_editor' }}
        reportsApi={reportsApi}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /根拠数値CSV/ }))
    await screen.findByText('根拠数値のCSVを保存しました。')
    expect(reportsApi.fetchProjectReportCsv).toHaveBeenCalledWith('project-1', 'server-1')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
  })
})
