import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAdsSetup } from './AdsSetupContext'
import { useAuth } from './AuthContext'
import { createProjectReportsApi } from '../api/projectReports'
import {
  buildEntry,
  loadHistory,
  saveHistory,
  storageKeyForCase,
  REPORT_HISTORY_MAX,
} from '../utils/reportHistoryStorage'
import {
  buildServerReportRequest,
  compactLegacyEntryToMarker,
  isServerMigrationMarker,
  migrateLegacyReportHistory,
  serverReportToHistoryEntry,
} from '../utils/serverReportHistory'

const ReportHistoryContext = createContext(null)

export const REPORT_HISTORY_UPDATED_EVENT = 'report-history-updated'

function newestFirst(entries) {
  return [...entries]
    .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))
    .slice(0, REPORT_HISTORY_MAX)
}

function pendingLocalHistory(caseId, syncState = 'pending') {
  return loadHistory(caseId)
    .filter((entry) => !isServerMigrationMarker(entry))
    .map((entry) => ({ ...entry, _syncState: syncState }))
}

function safeHistoryMessage(state) {
  if (state === 'saving') return '履歴を安全に保存しています。'
  if (state === 'restoring') return '保存済みレポートを読み込んでいます。'
  if (state === 'partial') return '一部の端末内履歴をまだ同期できていません。再試行できます。'
  if (state === 'error') return '履歴サーバーへ接続できませんでした。保存済みのふりはせず、未同期として表示しています。'
  if (state === 'local_only') return '現在は移行モードです。ログイン後に端末内履歴をサーバーへ同期します。'
  return ''
}

export function ReportHistoryProvider({
  children,
  reportsApi: injectedReportsApi = null,
  storage = globalThis.localStorage,
}) {
  const { currentCase } = useAdsSetup()
  const { getAccessToken, isAdsAuthenticated, user } = useAuth()
  const caseId = currentCase?.case_id ?? currentCase?.project_id ?? null
  const projectRef = currentCase?.project_id
    ?? currentCase?.project_ref
    ?? currentCase?.slug
    ?? currentCase?.case_id
    ?? null
  const projectAliases = useMemo(
    () => [...new Set([
      currentCase?.case_id,
      currentCase?.legacy_case_id,
      currentCase?.slug,
      currentCase?.project_id,
    ].filter(Boolean))],
    [
      currentCase?.case_id,
      currentCase?.legacy_case_id,
      currentCase?.project_id,
      currentCase?.slug,
    ],
  )
  const effectiveRole = currentCase?.project_role
    ?? user?.project_role
    ?? user?.workspace_role
    ?? user?.role
    ?? null
  const canManageHistory = Boolean(
    isAdsAuthenticated
    && effectiveRole !== 'project_viewer'
    && effectiveRole !== 'client',
  )

  const reportsApi = useMemo(() => injectedReportsApi || createProjectReportsApi({
    getToken: getAccessToken,
  }), [getAccessToken, injectedReportsApi])
  const serverEnabled = Boolean(projectRef && isAdsAuthenticated)
  const serverProjectIdRef = useRef(null)
  const refreshSequenceRef = useRef(0)

  const [history, setHistory] = useState(() => loadHistory(caseId))
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [historyState, setHistoryState] = useState('idle')
  const [historyErrorCode, setHistoryErrorCode] = useState(null)

  const refreshServerHistory = useCallback(async ({ showLoading = true } = {}) => {
    const sequence = ++refreshSequenceRef.current
    if (!caseId || !projectRef) {
      serverProjectIdRef.current = null
      setHistory([])
      setHistoryState('idle')
      setHistoryErrorCode(null)
      return
    }
    if (!serverEnabled) {
      serverProjectIdRef.current = null
      setHistory(newestFirst(pendingLocalHistory(caseId, 'local_only')))
      setHistoryState('local_only')
      setHistoryErrorCode(null)
      return
    }

    if (showLoading) setHistoryState('loading')
    try {
      let response = await reportsApi.listProjectReports(projectRef)
      if (sequence !== refreshSequenceRef.current) return
      serverProjectIdRef.current = response?.project_id || null

      const migration = await migrateLegacyReportHistory({
        projectRef,
        projectAliases,
        storage,
        key: storageKeyForCase(caseId),
        importReport: reportsApi.importProjectReport,
      })
      if (sequence !== refreshSequenceRef.current) return
      if (migration.imported.length > 0) {
        response = await reportsApi.listProjectReports(projectRef)
        if (sequence !== refreshSequenceRef.current) return
        serverProjectIdRef.current = response?.project_id || serverProjectIdRef.current
      }

      const serverEntries = (Array.isArray(response?.reports) ? response.reports : [])
        .map((report) => serverReportToHistoryEntry(report, { projectRef }))
        .filter(Boolean)
        .map((entry) => ({ ...entry, _syncState: 'saved' }))
      const unsynced = pendingLocalHistory(
        caseId,
        migration.failed.length || migration.rejected.length ? 'error' : 'pending',
      )
      setHistory(newestFirst([...unsynced, ...serverEntries]))
      const isPartial = Boolean(
        migration.failed.length
        || migration.rejected.length
        || migration.storageError,
      )
      setHistoryState(isPartial ? 'partial' : 'ready')
      setHistoryErrorCode(isPartial ? 'history_migration_incomplete' : null)
    } catch (error) {
      if (sequence !== refreshSequenceRef.current) return
      setHistory(newestFirst(pendingLocalHistory(caseId, 'error')))
      setHistoryState('error')
      setHistoryErrorCode(error?.code || 'history_unavailable')
    }
  }, [caseId, projectAliases, projectRef, reportsApi, serverEnabled, storage])

  useEffect(() => {
    void refreshServerHistory()
    return () => {
      refreshSequenceRef.current += 1
    }
  }, [refreshServerHistory])

  useEffect(() => {
    const onUpdate = () => void refreshServerHistory({ showLoading: false })
    window.addEventListener(REPORT_HISTORY_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(REPORT_HISTORY_UPDATED_EVENT, onUpdate)
  }, [refreshServerHistory])

  const ensureServerProjectId = useCallback(async () => {
    if (serverProjectIdRef.current) return serverProjectIdRef.current
    const response = await reportsApi.listProjectReports(projectRef)
    const projectId = response?.project_id
    if (typeof projectId !== 'string' || !projectId) {
      throw new Error('project_not_resolved')
    }
    serverProjectIdRef.current = projectId
    return projectId
  }, [projectRef, reportsApi])

  const persistEntry = useCallback(async (entry) => {
    if (!serverEnabled || !projectRef || !caseId) return
    setHistoryState('saving')
    setHistoryErrorCode(null)
    try {
      const projectId = await ensureServerProjectId()
      const request = buildServerReportRequest(entry, { projectRef, projectId })
      const result = request.mode === 'create'
        ? await reportsApi.createProjectReport(
            projectRef,
            request.payload,
            { idempotencyKey: request.idempotencyKey },
          )
        : await reportsApi.importProjectReport(
            projectRef,
            request.payload,
            { idempotencyKey: request.idempotencyKey },
          )
      const reportId = result?.report?.id
      if (typeof reportId !== 'string' || !reportId) throw new Error('report_not_saved')

      const current = loadHistory(caseId)
      const importedAt = new Date().toISOString()
      const marker = compactLegacyEntryToMarker(entry, {
        clientEntryId: request.payload.client_entry_id,
        reportId,
        importedAt,
      })
      saveHistory(caseId, current.map((item) => (item.id === entry.id ? marker : item)))
      await refreshServerHistory({ showLoading: false })
    } catch (error) {
      setHistory((current) => current.map((item) => (
        item.id === entry.id ? { ...item, _syncState: 'error' } : item
      )))
      setHistoryState('error')
      setHistoryErrorCode(error?.code || 'history_save_failed')
    }
  }, [caseId, ensureServerProjectId, projectRef, refreshServerHistory, reportsApi, serverEnabled])

  const addEntry = useCallback((entryData) => {
    if (!caseId) return null
    const entry = buildEntry({
      caseId,
      setupState: entryData.setupState,
      reportBundle: entryData.reportBundle,
      messages: entryData.messages,
      contextMode: entryData.contextMode,
    })
    const current = loadHistory(caseId).filter((item) => item.id !== entry.id)
    saveHistory(caseId, [entry, ...current].slice(0, REPORT_HISTORY_MAX))
    const syncState = serverEnabled ? 'saving' : 'local_only'
    setHistory((existing) => newestFirst([
      { ...entry, _syncState: syncState },
      ...existing.filter((item) => item.id !== entry.id),
    ]))
    setHistoryState(syncState)
    if (serverEnabled) void persistEntry(entry)
    return entry
  }, [caseId, persistEntry, serverEnabled])

  const removeEntry = useCallback((id) => {
    if (!caseId || !id) return
    const entry = history.find((item) => item.id === id)
    if (!entry) return
    if (entry.serverReportId && !canManageHistory) {
      setHistoryState('error')
      setHistoryErrorCode('history_delete_forbidden')
      return
    }

    setHistory((current) => current.filter((item) => item.id !== id))
    const local = loadHistory(caseId).filter((item) => item.id !== id)
    saveHistory(caseId, local)
    if (!entry.serverReportId || !serverEnabled) return

    void reportsApi.deleteProjectReport(projectRef, entry.serverReportId)
      .then(() => refreshServerHistory({ showLoading: false }))
      .catch((error) => {
        setHistoryState('error')
        setHistoryErrorCode(error?.code || 'history_delete_failed')
        void refreshServerHistory({ showLoading: false })
      })
  }, [canManageHistory, caseId, history, projectRef, refreshServerHistory, reportsApi, serverEnabled])

  const restoreEntry = useCallback((id) => {
    const entry = history.find((item) => item.id === id)
    if (!entry) return null
    if (!entry.serverReportId || !serverEnabled) {
      setRestoreTarget({ entry, at: Date.now() })
      return entry
    }

    setHistoryState('restoring')
    setHistoryErrorCode(null)
    void reportsApi.getProjectReport(projectRef, entry.serverReportId)
      .then((response) => {
        const restored = serverReportToHistoryEntry(response?.report, { projectRef })
        if (!restored) throw new Error('report_restore_invalid')
        setRestoreTarget({ entry: restored, at: Date.now() })
        setHistoryState('ready')
      })
      .catch((error) => {
        setHistoryState('error')
        setHistoryErrorCode(error?.code || 'history_restore_failed')
      })
    return entry
  }, [history, projectRef, reportsApi, serverEnabled])

  const clearAll = useCallback(() => {
    if (!caseId || !canManageHistory) return
    const serverIds = history
      .map((entry) => entry.serverReportId)
      .filter(Boolean)
    saveHistory(caseId, [])
    setHistory([])
    if (!serverEnabled || serverIds.length === 0) return

    setHistoryState('saving')
    void Promise.allSettled(
      serverIds.map((reportId) => reportsApi.deleteProjectReport(projectRef, reportId)),
    ).then((results) => {
      const failed = results.some((result) => result.status === 'rejected')
      if (failed) {
        setHistoryState('error')
        setHistoryErrorCode('history_delete_failed')
      }
      return refreshServerHistory({ showLoading: false })
    })
  }, [canManageHistory, caseId, history, projectRef, refreshServerHistory, reportsApi, serverEnabled])

  const clearRestoreTarget = useCallback(() => setRestoreTarget(null), [])
  const retryHistorySync = useCallback(
    () => refreshServerHistory(),
    [refreshServerHistory],
  )

  return (
    <ReportHistoryContext.Provider
      value={{
        history,
        caseId,
        projectRef,
        addEntry,
        removeEntry,
        restoreEntry,
        clearAll,
        restoreTarget,
        clearRestoreTarget,
        retryHistorySync,
        historyState,
        historyMessage: safeHistoryMessage(historyState),
        historyErrorCode,
        canManageHistory,
        maxEntries: REPORT_HISTORY_MAX,
      }}
    >
      {children}
    </ReportHistoryContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReportHistory() {
  const ctx = useContext(ReportHistoryContext)
  if (!ctx) throw new Error('useReportHistory must be used within ReportHistoryProvider')
  return ctx
}
