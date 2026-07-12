import { describe, expect, it } from 'vitest'
import {
  canManageReportShares,
  customerReportPrintPath,
  customerReportSharePath,
  customerReportShareUrl,
  findPersistedReportId,
  sanitizeSharedReportText,
} from '../reportSharing'

describe('reportSharing', () => {
  it('allows only owner/admin roles to manage public links', () => {
    expect(canManageReportShares({ role: 'admin' }, 'p1')).toBe(true)
    expect(canManageReportShares({ workspace_role: 'workspace_owner' }, 'p1')).toBe(true)
    expect(canManageReportShares({ project_roles: { p1: 'project_admin' } }, 'p1')).toBe(true)
    expect(canManageReportShares({ project_role: 'project_editor' }, 'p1')).toBe(false)
    expect(canManageReportShares({ role: 'project_viewer' }, 'p1')).toBe(false)
    expect(canManageReportShares({ role: 'case_user' }, 'p1')).toBe(false)
  })

  it('removes implementation vocabulary from public copy', () => {
    const value = sanitizeSharedReportText(
      'GA4 BigQuery dataset ID PV CV chart_01 null API key APIキーを確認',
    )

    expect(value).not.toMatch(/GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key|APIキー/i)
    expect(value).toContain('サイト計測')
    expect(value).toContain('根拠グラフ')
  })

  it('builds encoded frontend paths without query-string tokens', () => {
    expect(customerReportSharePath('a/b token')).toBe('/report-shares/a%2Fb%20token')
    expect(customerReportShareUrl('token', { origin: 'https://app.example' })).toBe(
      'https://app.example/report-shares/token',
    )
    expect(customerReportPrintPath('project/1', 'report 1')).toBe(
      '/projects/project%2F1/reports/report%201/print',
    )
  })

  it('resolves only a unique persisted row and never treats a local history id as persisted', () => {
    const report = { report_id: 'contract-1' }
    const serverRows = [{ id: 'server-1', report: { report_id: 'contract-1' } }]
    const savedHistory = [{
      id: 'local-marker',
      serverReportId: 'server-2',
      reportBundle: { reportV2: { report_id: 'contract-1' } },
    }]
    const localHistory = [{
      id: 'local-only',
      reportBundle: { reportV2: { report_id: 'contract-1' } },
    }]

    expect(findPersistedReportId(serverRows, report)).toBe('server-1')
    expect(findPersistedReportId(savedHistory, report)).toBe('server-2')
    expect(findPersistedReportId(localHistory, report)).toBeNull()
    expect(findPersistedReportId([...serverRows, ...serverRows], report)).toBeNull()
    expect(findPersistedReportId([], report, 'explicit-server-id')).toBe('explicit-server-id')
  })
})
