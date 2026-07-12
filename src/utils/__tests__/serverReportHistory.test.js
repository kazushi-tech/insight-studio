import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEGACY_IMPORT_LIMIT,
  buildLegacyImportPayload,
  buildServerReportRequest,
  compactLegacyEntryToMarker,
  legacyClientEntryId,
  migrateLegacyReportHistory,
  planLegacyReportImports,
  serverReportToHistoryEntry,
} from '../serverReportHistory'


function legacyEntry(overrides = {}) {
  return {
    version: 1,
    id: 'entry-1',
    caseId: 'project-one',
    createdAt: '2026-04-15T05:32:00.000Z',
    setupState: { periods: ['2026-03'], queryTypes: ['pv'] },
    reportBundle: {
      reportMd: '# Report\nUsers increased.',
      chartGroups: [{ title: 'Users', values: [3] }],
      generatedAt: '2026-04-15T05:33:00.000Z',
    },
    messages: [
      { role: 'user', text: 'show me' },
      { role: 'ai', text: 'done', timestamp: '2026-04-15T05:33:00.000Z' },
    ],
    metadata: { title: 'April report', tldr: 'Users increased.' },
    ...overrides,
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    value: (key) => values.get(key),
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('legacy report migration planning', () => {
  it('validates schema, capacity, ownership and the 20-entry maximum', () => {
    const entries = Array.from({ length: LEGACY_IMPORT_LIMIT + 1 }, (_, index) => (
      legacyEntry({ id: `entry-${index}` })
    ))
    entries[1] = legacyEntry({ id: 'wrong-project', caseId: 'other-project' })
    entries[2] = legacyEntry({ id: 'bad-schema', reportBundle: null })
    entries[3] = legacyEntry({ id: 'too-large', reportBundle: { reportMd: 'x'.repeat(500) } })
    const plan = planLegacyReportImports(JSON.stringify(entries), {
      projectRef: 'p1',
      projectAliases: ['project-one'],
      maxEntryBytes: 400,
      maxHistoryBytes: 100_000,
    })

    expect(plan.rejected).toEqual(expect.arrayContaining([
      { index: 1, reason: 'project_mismatch' },
      { index: 2, reason: 'invalid_report_bundle' },
      { index: 3, reason: 'entry_too_large' },
      { index: 20, reason: 'entry_limit_exceeded' },
    ]))
    expect(plan.candidates.every(({ payload }) => (
      payload.source_schema === 'report.v1'
      && payload.report.schema_version === 'report.v1'
    ))).toBe(true)
  })

  it('deduplicates client_entry_id and builds a legacy import without mutating input', () => {
    const first = legacyEntry({ client_entry_id: 'stable-client-entry' })
    const duplicate = legacyEntry({ client_entry_id: 'stable-client-entry' })
    const original = structuredClone(first)
    const plan = planLegacyReportImports(JSON.stringify([first, duplicate]), {
      projectRef: 'project-one',
    })
    const payload = buildLegacyImportPayload(first, {
      projectRef: 'project-one',
      clientEntryId: legacyClientEntryId(first),
    })

    expect(plan.candidates).toHaveLength(1)
    expect(plan.candidates[0].indexes).toEqual([0, 1])
    expect(plan.skipped).toContainEqual(expect.objectContaining({
      index: 1,
      reason: 'duplicate_client_entry_id',
    }))
    expect(payload.messages).toEqual([
      { role: 'user', content: 'show me' },
      {
        role: 'assistant',
        content: 'done',
        metadata: { timestamp: '2026-04-15T05:33:00.000Z' },
      },
    ])
    expect(payload.report.legacy_entry).not.toHaveProperty('messages')
    expect(first).toEqual(original)
  })
})

describe('migrateLegacyReportHistory', () => {
  it('imports each client entry once and replaces successful bodies with markers only', async () => {
    const key = 'insight-studio-ads-report-history:project-one'
    const first = legacyEntry({ client_entry_id: 'stable-client-entry' })
    const duplicate = legacyEntry({ client_entry_id: 'stable-client-entry' })
    const storage = memoryStorage({ [key]: JSON.stringify([first, duplicate]) })
    const importReport = vi.fn().mockResolvedValue({
      ok: true,
      created: true,
      report: { id: 'server-report-1' },
    })

    const result = await migrateLegacyReportHistory({
      projectRef: 'project-one',
      storage,
      importReport,
      now: () => new Date('2026-07-12T03:00:00.000Z'),
    })

    expect(importReport).toHaveBeenCalledTimes(1)
    expect(importReport).toHaveBeenCalledWith(
      'project-one',
      expect.objectContaining({
        client_entry_id: 'stable-client-entry',
        source_schema: 'report.v1',
      }),
      { idempotencyKey: 'legacy-import:stable-client-entry' },
    )
    expect(result.compacted).toBe(true)
    expect(localStorage.length).toBe(0)
    const stored = JSON.parse(storage.value(key))
    expect(stored).toHaveLength(2)
    for (const marker of stored) {
      expect(Object.keys(marker).sort()).toEqual([
        'caseId', 'createdAt', 'id', 'serverMigration', 'version',
      ])
      expect(marker.serverMigration).toEqual({
        status: 'imported',
        sourceSchema: 'report.v1',
        clientEntryId: 'stable-client-entry',
        reportId: 'server-report-1',
        importedAt: '2026-07-12T03:00:00.000Z',
      })
      expect(marker).not.toHaveProperty('reportBundle')
      expect(marker).not.toHaveProperty('messages')
      expect(JSON.stringify(marker)).not.toContain('Users increased')
    }

    const secondRunImport = vi.fn()
    const secondRun = await migrateLegacyReportHistory({
      projectRef: 'project-one',
      storage,
      importReport: secondRunImport,
    })
    expect(secondRunImport).not.toHaveBeenCalled()
    expect(secondRun.skipped).toHaveLength(2)
  })

  it('preserves full entries when import fails and reports storage compaction failures', async () => {
    const key = 'insight-studio-ads-report-history:project-one'
    const entry = legacyEntry()
    const failedStorage = memoryStorage({ [key]: JSON.stringify([entry]) })
    const failed = await migrateLegacyReportHistory({
      projectRef: 'project-one',
      storage: failedStorage,
      importReport: vi.fn().mockRejectedValue(new Error('offline')),
    })
    expect(failed.failed).toHaveLength(1)
    expect(failedStorage.setItem).not.toHaveBeenCalled()
    expect(JSON.parse(failedStorage.value(key))[0].reportBundle.reportMd).toContain('Users')

    const quotaStorage = memoryStorage({ [key]: JSON.stringify([entry]) })
    quotaStorage.setItem.mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const imported = await migrateLegacyReportHistory({
      projectRef: 'project-one',
      storage: quotaStorage,
      importReport: vi.fn().mockResolvedValue({ report: { id: 'server-2' } }),
    })
    expect(imported.imported).toHaveLength(1)
    expect(imported.compacted).toBe(false)
    expect(imported.storageError?.name).toBe('QuotaExceededError')
    // Idempotent client_entry_id means a retry cannot create a duplicate server row.
    expect(imported.imported[0].clientEntryId).toBe(legacyClientEntryId(entry))
  })

  it('creates marker objects with no legacy body fields', () => {
    const entry = legacyEntry()
    const marker = compactLegacyEntryToMarker(entry, {
      clientEntryId: 'client-1',
      reportId: 'report-1',
      importedAt: '2026-07-12T03:00:00.000Z',
    })
    expect(marker.serverMigration.status).toBe('imported')
    expect(marker).not.toHaveProperty('reportBundle')
    expect(marker).not.toHaveProperty('setupState')
    expect(marker).not.toHaveProperty('metadata')
  })
})

describe('server report history view models', () => {
  it('restores report.v2 without exposing a dataset and persists it with the resolved project id', () => {
    const report = {
      schema_version: 'report.v2',
      report_id: 'client-report-1',
      project_id: 'project-slug',
      scope: {
        current_period: { start: '2026-07-01', end: '2026-07-07' },
      },
      availability: { overall: 'full', metrics: [] },
      metrics: [],
      conclusions: [{ title: '訪問が増えました', body: '前の期間より増えています。' }],
      actions: [{ title: '入口を確認する', reason: '増えた流入を確かめるためです。' }],
      evidence: [{ key: 'traffic-total', query_type: 'traffic', title: '訪問数', chart: null }],
      caveats: ['費用対効果はこのデータだけでは判断できません。'],
      generated_at: '2026-07-12T03:00:00.000Z',
    }
    const row = {
      id: 'server-report-1',
      source_schema: 'report.v2',
      report,
      title: '7月のWeb成果',
      created_at: '2026-07-12T03:00:00.000Z',
      messages: [{ role: 'assistant', content: '確認しました。', metadata: {} }],
    }
    const entry = serverReportToHistoryEntry(row, { projectRef: 'project-slug' })
    expect(entry.serverReportId).toBe('server-report-1')
    expect(entry.reportBundle.reportV2).toEqual(report)
    expect(entry.reportBundle.reportMd).toContain('まだ判断できないこと')
    expect(entry.setupState.datasetId).toBe('')
    expect(entry.messages).toEqual([{ role: 'assistant', text: '確認しました。' }])

    const request = buildServerReportRequest(entry, {
      projectRef: 'project-slug',
      projectId: 'database-project-id',
    })
    expect(request.mode).toBe('create')
    expect(request.payload.report.project_id).toBe('database-project-id')
    expect(request.payload.report.report_id).toBe('client-report-1')
    expect(report.project_id).toBe('project-slug')
    expect(request.payload.messages).toEqual([
      { role: 'assistant', content: '確認しました。' },
    ])
  })

  it('keeps legacy rows explicit and never relabels them as report.v2', () => {
    const original = legacyEntry()
    const entry = serverReportToHistoryEntry({
      id: 'server-legacy-1',
      source_schema: 'report.v1',
      report: { schema_version: 'report.v1', legacy_entry: original },
      messages: [{ role: 'user', content: 'もう一度見せて' }],
      created_at: '2026-07-12T03:00:00.000Z',
    }, { projectRef: 'project-one' })
    const request = buildServerReportRequest(entry, {
      projectRef: 'project-one',
      projectId: 'database-project-id',
    })
    expect(entry.serverReportId).toBe('server-legacy-1')
    expect(request.mode).toBe('import')
    expect(request.payload.source_schema).toBe('report.v1')
    expect(request.payload.report.schema_version).toBe('report.v1')
  })
})
