import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAdsSetup } from './AdsSetupContext'
import {
  buildEntry,
  loadHistory,
  saveHistory,
  REPORT_HISTORY_MAX,
} from '../utils/reportHistoryStorage'

const ReportHistoryContext = createContext(null)

export const REPORT_HISTORY_UPDATED_EVENT = 'report-history-updated'

export function ReportHistoryProvider({ children }) {
  const { currentCase } = useAdsSetup()
  const caseId = currentCase?.case_id ?? null

  const [history, setHistory] = useState(() => loadHistory(caseId))
  const [restoreTarget, setRestoreTarget] = useState(null)

  useEffect(() => {
    setHistory(loadHistory(caseId))
  }, [caseId])

  useEffect(() => {
    const onUpdate = () => setHistory(loadHistory(caseId))
    window.addEventListener(REPORT_HISTORY_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(REPORT_HISTORY_UPDATED_EVENT, onUpdate)
  }, [caseId])

  const addEntry = useCallback((entryData) => {
    if (!caseId) return null
    const entry = buildEntry({
      caseId,
      setupState: entryData.setupState,
      reportBundle: entryData.reportBundle,
      messages: entryData.messages,
      contextMode: entryData.contextMode,
    })
    const current = loadHistory(caseId)
    const next = [entry, ...current].slice(0, REPORT_HISTORY_MAX)
    saveHistory(caseId, next)
    setHistory(next)
    return entry
  }, [caseId])

  const removeEntry = useCallback((id) => {
    if (!caseId || !id) return
    const current = loadHistory(caseId)
    const next = current.filter((e) => e.id !== id)
    saveHistory(caseId, next)
    setHistory(next)
  }, [caseId])

  const restoreEntry = useCallback((id) => {
    const entry = history.find((h) => h.id === id)
    if (!entry) return null
    setRestoreTarget({ entry, at: Date.now() })
    return entry
  }, [history])

  const clearAll = useCallback(() => {
    if (!caseId) return
    saveHistory(caseId, [])
    setHistory([])
  }, [caseId])

  const clearRestoreTarget = useCallback(() => setRestoreTarget(null), [])

  return (
    <ReportHistoryContext.Provider
      value={{
        history,
        caseId,
        addEntry,
        removeEntry,
        restoreEntry,
        clearAll,
        restoreTarget,
        clearRestoreTarget,
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
