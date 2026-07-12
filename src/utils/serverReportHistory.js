import { storageKeyForCase } from './reportHistoryStorage'

export const LEGACY_REPORT_VERSION = 1
export const LEGACY_IMPORT_LIMIT = 20
export const MAX_LEGACY_ENTRY_BYTES = 1_900_000
export const MAX_LEGACY_HISTORY_BYTES = 5_000_000
export const MAX_SERVER_REPORT_BYTES = 2_000_000

function utf8Size(value) {
  return new TextEncoder().encode(value).byteLength
}

function jsonSize(value) {
  try {
    return utf8Size(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validDateTime(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))
}

function stableHash(value) {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(value)
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function safeIdPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function legacyClientEntryId(entry) {
  if (
    typeof entry?.client_entry_id === 'string'
    && entry.client_entry_id.trim()
    && entry.client_entry_id.trim().length <= 100
  ) {
    return entry.client_entry_id.trim()
  }
  const identity = `${entry?.caseId || ''}\u001f${entry?.id || ''}`
  const readable = safeIdPart(entry?.id).slice(0, 70) || 'entry'
  return `legacy-${stableHash(identity)}-${readable}`.slice(0, 100)
}

export function isServerMigrationMarker(entry) {
  return isObject(entry)
    && entry.version === LEGACY_REPORT_VERSION
    && typeof entry.id === 'string'
    && entry.serverMigration?.status === 'imported'
    && typeof entry.serverMigration?.clientEntryId === 'string'
    && !Object.hasOwn(entry, 'reportBundle')
    && !Object.hasOwn(entry, 'messages')
}

export function defaultLegacyProjectOwnership(entry, { projectRefs }) {
  return typeof entry?.caseId === 'string' && projectRefs.has(entry.caseId)
}

function validateLegacyEntry(entry, options) {
  if (!isObject(entry)) return 'invalid_entry'
  if (isServerMigrationMarker(entry)) return null
  if (entry.version !== LEGACY_REPORT_VERSION) return 'invalid_version'
  if (typeof entry.id !== 'string' || !entry.id.trim()) return 'invalid_id'
  if (typeof entry.caseId !== 'string' || !entry.caseId.trim()) return 'invalid_project'
  if (!validDateTime(entry.createdAt)) return 'invalid_created_at'
  if (!isObject(entry.reportBundle) || typeof entry.reportBundle.reportMd !== 'string') {
    return 'invalid_report_bundle'
  }
  if (
    !Array.isArray(entry.messages)
    || entry.messages.length > 500
    || entry.messages.some((message) => (
      !isObject(message)
      || !['user', 'assistant', 'ai', 'system', 'tool'].includes(message.role)
      || typeof message.text !== 'string'
      || !message.text
      || message.text.length > 100_000
    ))
  ) return 'invalid_messages'
  if (entry.setupState != null && !isObject(entry.setupState)) return 'invalid_setup_state'
  if (entry.metadata != null && !isObject(entry.metadata)) return 'invalid_metadata'
  if (entry.contextMode != null && !['ads-only', 'ads-with-ml'].includes(entry.contextMode)) {
    return 'invalid_context_mode'
  }
  if (!options.ownsEntry(entry, options)) return 'project_mismatch'
  if (jsonSize(entry) > options.maxEntryBytes) return 'entry_too_large'
  return null
}

function legacyMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message) => isObject(message) && typeof message.text === 'string' && message.text)
    .map((message) => {
      const role = message.role === 'ai' ? 'assistant' : message.role
      if (!['user', 'assistant', 'system', 'tool'].includes(role)) return null
      const metadata = {
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        ...(message.isError ? { is_error: true } : {}),
      }
      return {
        role,
        content: message.text,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      }
    })
    .filter(Boolean)
}

function serverMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message) => isObject(message) && typeof message.content === 'string')
    .map((message) => ({
      role: message.role === 'ai' ? 'assistant' : message.role,
      text: message.content,
      ...(message.metadata?.is_error ? { isError: true } : {}),
      ...((message.metadata?.timestamp || message.created_at)
        ? { timestamp: message.metadata?.timestamp || message.created_at }
        : {}),
    }))
}

function periodLabel(report) {
  const period = report?.scope?.current_period
  if (!isObject(period)) return '対象期間'
  const start = typeof period.start === 'string' ? period.start : ''
  const end = typeof period.end === 'string' ? period.end : ''
  if (!start && !end) return '対象期間'
  return start === end || !end ? start : `${start}〜${end}`
}

function reportV2Markdown(report) {
  const conclusions = Array.isArray(report?.conclusions) ? report.conclusions.slice(0, 3) : []
  const actions = Array.isArray(report?.actions) ? report.actions.slice(0, 3) : []
  const caveats = Array.isArray(report?.caveats) ? report.caveats : []
  const lines = ['# Web成果レポート', '', `対象期間: ${periodLabel(report)}`]
  if (conclusions.length) {
    lines.push('', '## 今回の結論')
    conclusions.forEach((item) => {
      const body = typeof item?.body === 'string' && item.body ? ` — ${item.body}` : ''
      lines.push(`- ${item?.title || '確認できたこと'}${body}`)
    })
  }
  if (actions.length) {
    lines.push('', '## 次にやること')
    actions.forEach((item) => {
      const reason = typeof item?.reason === 'string' && item.reason ? ` — ${item.reason}` : ''
      lines.push(`- ${item?.title || '次の確認'}${reason}`)
    })
  }
  if (caveats.length) {
    lines.push('', '## まだ判断できないこと')
    caveats.forEach((item) => lines.push(`- ${item}`))
  }
  return lines.join('\n')
}

function reportV2Summary(report) {
  const first = Array.isArray(report?.conclusions) ? report.conclusions[0] : null
  return first?.body || first?.title || '保存済みのWeb成果レポート'
}

/**
 * Convert a server report row into the existing history drawer view model.
 * Full messages are present only after GET /reports/{id}; list rows remain light.
 */
export function serverReportToHistoryEntry(serverReport, { projectRef } = {}) {
  if (!isObject(serverReport) || typeof serverReport.id !== 'string') return null
  const stored = isObject(serverReport.report) ? cloneJson(serverReport.report) : {}
  const messages = serverMessages(serverReport.messages)
  const createdAt = serverReport.created_at || serverReport.generated_at || new Date(0).toISOString()

  if (serverReport.source_schema !== 'report.v2' || stored.schema_version !== 'report.v2') {
    const legacy = isObject(stored.legacy_entry) ? stored.legacy_entry : null
    if (!legacy) {
      return {
        version: 1,
        id: serverReport.id,
        serverReportId: serverReport.id,
        caseId: projectRef || null,
        createdAt,
        setupState: null,
        reportBundle: null,
        messages,
        contextMode: 'ads-only',
        metadata: {
          title: serverReport.title || '移行済みレポート',
          tldr: serverReport.summary || '以前の形式で保存されたレポートです。',
          messageCount: messages.length,
          periodsLabel: '—',
          queryTypesLabel: 'Web成果',
        },
      }
    }
    return {
      ...legacy,
      id: serverReport.id,
      serverReportId: serverReport.id,
      caseId: projectRef || legacy.caseId || null,
      createdAt,
      messages,
      metadata: {
        ...(isObject(legacy.metadata) ? legacy.metadata : {}),
        ...(serverReport.title ? { title: serverReport.title } : {}),
        ...(serverReport.summary ? { tldr: serverReport.summary } : {}),
        messageCount: messages.length,
      },
    }
  }

  const queryTypes = [...new Set(
    (Array.isArray(stored.evidence) ? stored.evidence : [])
      .map((item) => item?.query_type)
      .filter((value) => typeof value === 'string' && value),
  )]
  const period = stored.scope?.current_period
  const periods = isObject(period) && typeof period.start === 'string'
    ? [period.start === period.end ? period.start : `${period.start}:${period.end}`]
    : []

  return {
    version: 2,
    id: serverReport.id,
    serverReportId: serverReport.id,
    caseId: projectRef || stored.project_id || null,
    createdAt,
    setupState: {
      queryTypes,
      periods,
      granularity: 'daily',
      datasetId: '',
      completedAt: stored.generated_at || createdAt,
    },
    reportBundle: {
      reportMd: reportV2Markdown(stored),
      chartGroups: [],
      generatedAt: stored.generated_at || serverReport.generated_at || createdAt,
      source: 'server_report_v2',
      reportV2: stored,
      dataAvailability: stored.availability?.overall || 'unavailable',
    },
    messages,
    contextMode: 'ads-only',
    metadata: {
      title: serverReport.title || 'Web成果レポート',
      tldr: serverReport.summary || reportV2Summary(stored),
      messageCount: messages.length,
      periodsLabel: periodLabel(stored),
      queryTypesLabel: 'Web成果',
    },
  }
}

/** Build either a canonical report.v2 create request or an explicit v1 import. */
export function buildServerReportRequest(entry, { projectRef, projectId } = {}) {
  if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id) {
    throw new TypeError('history entry is required')
  }
  const reportV2 = entry.reportBundle?.reportV2
  const common = {
    client_entry_id: legacyClientEntryId(entry),
    ...(typeof entry.metadata?.title === 'string' && entry.metadata.title
      ? { title: entry.metadata.title.slice(0, 300) }
      : {}),
    ...(typeof entry.metadata?.tldr === 'string' && entry.metadata.tldr
      ? { summary: entry.metadata.tldr.slice(0, 20_000) }
      : {}),
    messages: legacyMessages(entry.messages),
  }
  if (isObject(reportV2) && reportV2.schema_version === 'report.v2') {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw new TypeError('projectId is required for report.v2 persistence')
    }
    return {
      mode: 'create',
      idempotencyKey: `report-create:${legacyClientEntryId(entry)}`,
      payload: {
        ...common,
        report: {
          ...cloneJson(reportV2),
          project_id: projectId.trim(),
        },
      },
    }
  }
  return {
    mode: 'import',
    idempotencyKey: `legacy-import:${legacyClientEntryId(entry)}`,
    payload: buildLegacyImportPayload(entry, {
      projectRef: projectRef || entry.caseId,
      clientEntryId: legacyClientEntryId(entry),
    }),
  }
}

export function buildLegacyImportPayload(entry, { projectRef, clientEntryId } = {}) {
  const cloned = cloneJson(entry)
  const messages = legacyMessages(cloned.messages)
  delete cloned.messages
  delete cloned.client_entry_id
  delete cloned.serverMigration

  return {
    client_entry_id: clientEntryId || legacyClientEntryId(entry),
    source_schema: 'report.v1',
    ...(typeof entry?.metadata?.title === 'string' && entry.metadata.title
      ? { title: entry.metadata.title.slice(0, 300) }
      : {}),
    ...(typeof entry?.metadata?.tldr === 'string' && entry.metadata.tldr
      ? { summary: entry.metadata.tldr.slice(0, 20_000) }
      : {}),
    report: {
      schema_version: 'report.v1',
      source: 'localStorage.reportHistory.v1',
      project_ref: projectRef,
      legacy_entry: cloned,
    },
    messages,
  }
}

export function compactLegacyEntryToMarker(
  entry,
  { clientEntryId, reportId, importedAt },
) {
  return {
    version: LEGACY_REPORT_VERSION,
    id: entry.id,
    caseId: entry.caseId,
    createdAt: entry.createdAt,
    serverMigration: {
      status: 'imported',
      sourceSchema: 'report.v1',
      clientEntryId,
      reportId,
      importedAt,
    },
  }
}

export function planLegacyReportImports(raw, {
  projectRef,
  projectAliases = [],
  ownsEntry = defaultLegacyProjectOwnership,
  maxEntries = LEGACY_IMPORT_LIMIT,
  maxEntryBytes = MAX_LEGACY_ENTRY_BYTES,
  maxHistoryBytes = MAX_LEGACY_HISTORY_BYTES,
} = {}) {
  if (typeof projectRef !== 'string' || !projectRef.trim()) {
    throw new TypeError('projectRef is required')
  }
  const empty = { entries: [], candidates: [], rejected: [], skipped: [] }
  const entryLimit = Math.min(
    LEGACY_IMPORT_LIMIT,
    Number.isInteger(maxEntries) && maxEntries >= 0 ? maxEntries : LEGACY_IMPORT_LIMIT,
  )
  const entryByteLimit = Math.min(
    MAX_LEGACY_ENTRY_BYTES,
    Number.isFinite(maxEntryBytes) && maxEntryBytes >= 0
      ? maxEntryBytes
      : MAX_LEGACY_ENTRY_BYTES,
  )
  const historyByteLimit = Math.min(
    MAX_LEGACY_HISTORY_BYTES,
    Number.isFinite(maxHistoryBytes) && maxHistoryBytes >= 0
      ? maxHistoryBytes
      : MAX_LEGACY_HISTORY_BYTES,
  )
  if (raw == null || raw === '') return empty
  if (typeof raw !== 'string') {
    return { ...empty, rejected: [{ index: null, reason: 'invalid_storage_value' }] }
  }
  if (utf8Size(raw) > historyByteLimit) {
    return { ...empty, rejected: [{ index: null, reason: 'history_too_large' }] }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...empty, rejected: [{ index: null, reason: 'invalid_json' }] }
  }
  if (!Array.isArray(parsed)) {
    return { ...empty, rejected: [{ index: null, reason: 'invalid_history_schema' }] }
  }

  const entries = parsed.slice()
  const projectRefs = new Set(
    [projectRef, ...projectAliases]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  )
  const context = {
    projectRef: projectRef.trim(),
    projectRefs,
    ownsEntry,
    maxEntryBytes: entryByteLimit,
  }
  const candidatesById = new Map()
  const rejected = []
  const skipped = []

  entries.forEach((entry, index) => {
    if (index >= entryLimit) {
      rejected.push({ index, reason: 'entry_limit_exceeded' })
      return
    }
    if (isServerMigrationMarker(entry)) {
      skipped.push({ index, reason: 'already_imported' })
      return
    }
    const invalidReason = validateLegacyEntry(entry, context)
    if (invalidReason) {
      rejected.push({ index, reason: invalidReason })
      return
    }

    const clientEntryId = legacyClientEntryId(entry)
    const payload = buildLegacyImportPayload(entry, {
      projectRef: context.projectRef,
      clientEntryId,
    })
    if (jsonSize(payload.report) > MAX_SERVER_REPORT_BYTES) {
      rejected.push({ index, reason: 'server_report_too_large' })
      return
    }
    const existing = candidatesById.get(clientEntryId)
    if (existing) {
      if (existing.payloadHash !== stableHash(JSON.stringify(payload))) {
        rejected.push({ index, reason: 'duplicate_client_entry_conflict', clientEntryId })
        return
      }
      existing.indexes.push(index)
      skipped.push({ index, reason: 'duplicate_client_entry_id', clientEntryId })
      return
    }
    candidatesById.set(clientEntryId, {
      clientEntryId,
      idempotencyKey: `legacy-import:${clientEntryId}`,
      indexes: [index],
      payload,
      payloadHash: stableHash(JSON.stringify(payload)),
    })
  })

  return {
    entries,
    candidates: [...candidatesById.values()].map((candidate) => ({
      clientEntryId: candidate.clientEntryId,
      idempotencyKey: candidate.idempotencyKey,
      indexes: candidate.indexes,
      payload: candidate.payload,
    })),
    rejected,
    skipped,
  }
}

export async function migrateLegacyReportHistory({
  projectRef,
  projectAliases = [],
  storage,
  importReport,
  key = storageKeyForCase(projectRef),
  ownsEntry = defaultLegacyProjectOwnership,
  now = () => new Date(),
  limits = {},
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('storage adapter is required')
  }
  if (typeof importReport !== 'function') throw new TypeError('importReport is required')
  if (!key) throw new TypeError('storage key is required')

  let raw
  try {
    raw = storage.getItem(key)
  } catch (storageError) {
    return {
      key,
      imported: [],
      failed: [],
      rejected: [],
      skipped: [],
      compacted: false,
      storageError,
      entries: [],
    }
  }
  const plan = planLegacyReportImports(raw, {
    projectRef,
    projectAliases,
    ownsEntry,
    ...limits,
  })
  const nextEntries = plan.entries.slice()
  const imported = []
  const failed = []

  for (const candidate of plan.candidates) {
    try {
      const result = await importReport(
        projectRef,
        candidate.payload,
        { idempotencyKey: candidate.idempotencyKey },
      )
      const reportId = result?.report?.id
      if (typeof reportId !== 'string' || !reportId) {
        throw new Error('import response did not contain report.id')
      }
      const importedAtValue = now()
      const importedAt = importedAtValue instanceof Date
        ? importedAtValue.toISOString()
        : new Date(importedAtValue).toISOString()
      for (const index of candidate.indexes) {
        nextEntries[index] = compactLegacyEntryToMarker(nextEntries[index], {
          clientEntryId: candidate.clientEntryId,
          reportId,
          importedAt,
        })
      }
      imported.push({
        clientEntryId: candidate.clientEntryId,
        reportId,
        indexes: [...candidate.indexes],
        created: result?.created !== false,
      })
    } catch (error) {
      failed.push({
        clientEntryId: candidate.clientEntryId,
        indexes: [...candidate.indexes],
        error,
      })
    }
  }

  let compacted = false
  let storageError = null
  if (imported.length > 0) {
    try {
      storage.setItem(key, JSON.stringify(nextEntries))
      compacted = true
    } catch (error) {
      storageError = error
    }
  }

  return {
    key,
    imported,
    failed,
    rejected: plan.rejected,
    skipped: plan.skipped,
    compacted,
    storageError,
    entries: nextEntries,
  }
}
