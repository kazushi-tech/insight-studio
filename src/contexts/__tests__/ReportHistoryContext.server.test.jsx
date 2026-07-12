import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportHistoryProvider, useReportHistory } from '../ReportHistoryContext'


const contextState = vi.hoisted(() => ({
  currentCase: {
    case_id: 'legacy-project',
    project_id: 'p1',
    slug: 'project-one',
    project_role: 'project_editor',
  },
  auth: {
    adsToken: 'memory-only-token',
    isAdsAuthenticated: true,
    user: { role: 'project_editor' },
  },
}))

vi.mock('../AdsSetupContext', () => ({
  useAdsSetup: () => ({ currentCase: contextState.currentCase }),
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => contextState.auth,
}))

function canonicalReport(projectId = 'p1') {
  return {
    schema_version: 'report.v2',
    report_id: 'client-report-1',
    project_id: projectId,
    scope: { current_period: { start: '2026-07-01', end: '2026-07-07' } },
    availability: { overall: 'full', metrics: [] },
    metrics: [],
    conclusions: [{ title: '訪問を確認しました', body: '前の期間との違いを確認できます。' }],
    actions: [],
    evidence: [],
    caveats: [],
    generated_at: '2026-07-12T03:00:00.000Z',
  }
}

function serverRow(overrides = {}) {
  return {
    id: 'server-report-1',
    source_schema: 'report.v2',
    title: '保存済みレポート',
    report: canonicalReport(),
    created_at: '2026-07-12T03:00:00.000Z',
    messages: [],
    ...overrides,
  }
}

function Probe() {
  const history = useReportHistory()
  return (
    <div>
      <output aria-label="state">{history.historyState}</output>
      <output aria-label="message">{history.historyMessage}</output>
      <output aria-label="count">{history.history.length}</output>
      <output aria-label="first-id">{history.history[0]?.serverReportId || ''}</output>
      <button
        type="button"
        onClick={() => history.addEntry({
          setupState: {
            periods: ['2026-07'],
            queryTypes: ['traffic'],
            granularity: 'monthly',
            completedAt: '2026-07-12T03:00:00.000Z',
          },
          reportBundle: {
            reportMd: '# Web成果レポート',
            reportV2: canonicalReport('project-slug-before-resolution'),
          },
          messages: [{ role: 'assistant', text: '確認しました。' }],
          contextMode: 'ads-only',
        })}
      >
        保存する
      </button>
    </div>
  )
}

function api(overrides = {}) {
  return {
    listProjectReports: vi.fn().mockResolvedValue({
      ok: true,
      project_id: 'p1',
      reports: [],
    }),
    importProjectReport: vi.fn().mockResolvedValue({
      ok: true,
      created: true,
      report: { id: 'imported-report-1' },
    }),
    createProjectReport: vi.fn().mockResolvedValue({
      ok: true,
      created: true,
      report: { id: 'server-report-1' },
    }),
    getProjectReport: vi.fn(),
    deleteProjectReport: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  contextState.currentCase = {
    case_id: 'legacy-project',
    project_id: 'p1',
    slug: 'project-one',
    project_role: 'project_editor',
  }
  contextState.auth = {
    adsToken: 'memory-only-token',
    isAdsAuthenticated: true,
    user: { role: 'project_editor' },
  }
})

describe('ReportHistoryContext server persistence', () => {
  it('loads cross-device history from the server as the visible source', async () => {
    const reportsApi = api({
      listProjectReports: vi.fn().mockResolvedValue({
        ok: true,
        project_id: 'p1',
        reports: [serverRow()],
      }),
    })
    render(
      <ReportHistoryProvider reportsApi={reportsApi}>
        <Probe />
      </ReportHistoryProvider>,
    )
    expect(await screen.findByText('ready', { selector: '[aria-label="state"]' })).toBeInTheDocument()
    expect(screen.getByLabelText('count')).toHaveTextContent('1')
    expect(screen.getByLabelText('first-id')).toHaveTextContent('server-report-1')
  })

  it('stores report.v2 with the resolved DB project id and compacts local content', async () => {
    const reportsApi = api()
    reportsApi.listProjectReports
      .mockResolvedValueOnce({ ok: true, project_id: 'p1', reports: [] })
      .mockResolvedValue({ ok: true, project_id: 'p1', reports: [serverRow()] })

    render(
      <ReportHistoryProvider reportsApi={reportsApi}>
        <Probe />
      </ReportHistoryProvider>,
    )
    await screen.findByText('ready', { selector: '[aria-label="state"]' })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(reportsApi.createProjectReport).toHaveBeenCalledTimes(1))
    const [, payload, options] = reportsApi.createProjectReport.mock.calls[0]
    expect(payload.report.project_id).toBe('p1')
    expect(options.idempotencyKey).toMatch(/^report-create:/)
    await waitFor(() => expect(screen.getByLabelText('state')).toHaveTextContent('ready'))

    const raw = localStorage.getItem('insight-studio-ads-report-history:legacy-project')
    const stored = JSON.parse(raw)
    expect(stored).toHaveLength(1)
    expect(stored[0].serverMigration.status).toBe('imported')
    expect(stored[0]).not.toHaveProperty('reportBundle')
    expect(stored[0]).not.toHaveProperty('messages')
  })

  it('keeps a visible unsynced queue when the server rejects a save', async () => {
    const reportsApi = api({
      createProjectReport: vi.fn().mockRejectedValue(Object.assign(
        new Error('internal provider detail'),
        { code: 'report_database_unavailable' },
      )),
    })
    render(
      <ReportHistoryProvider reportsApi={reportsApi}>
        <Probe />
      </ReportHistoryProvider>,
    )
    await screen.findByText('ready', { selector: '[aria-label="state"]' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    await waitFor(() => expect(screen.getByLabelText('state')).toHaveTextContent('error'))
    expect(screen.getByLabelText('message')).toHaveTextContent('保存済みのふりはせず')
    expect(screen.queryByText('internal provider detail')).not.toBeInTheDocument()
    const raw = localStorage.getItem('insight-studio-ads-report-history:legacy-project')
    expect(JSON.parse(raw)[0].reportBundle.reportV2.schema_version).toBe('report.v2')
  })
})
