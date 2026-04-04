import { createContext, useContext, useState, useSyncExternalStore } from 'react'

// ─── Run kinds ───
// compare | discovery | creative-review | banner-generation

const DRAFT_PREFIX = 'is-draft-'

function createRunStore() {
  const runs = new Map()
  const listeners = new Set()
  let snapshot = {}

  function syncSnapshot() {
    snapshot = Object.fromEntries(runs)
  }

  function notify() {
    listeners.forEach((fn) => fn())
  }

  function setDraft(kind, data) {
    try {
      sessionStorage.setItem(DRAFT_PREFIX + kind, JSON.stringify(data))
    } catch { /* quota exceeded — ignore */ }
    notify()
  }

  function getDraft(kind) {
    try {
      const raw = sessionStorage.getItem(DRAFT_PREFIX + kind)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function clearDraft(kind) {
    try { sessionStorage.removeItem(DRAFT_PREFIX + kind) } catch {}
    notify()
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function getSnapshot() {
    return snapshot
  }

  function getRun(kind) {
    return runs.get(kind) ?? null
  }

  function startRun(kind, input) {
    const run = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      status: 'running',
      input,
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
      error: null,
      meta: {},
    }
    runs.set(kind, run)
    syncSnapshot()
    notify()
    return run
  }

  function completeRun(kind, result, meta = {}) {
    const existing = runs.get(kind)
    if (!existing) return
    runs.set(kind, {
      ...existing,
      status: 'completed',
      finishedAt: Date.now(),
      result,
      meta: { ...existing.meta, ...meta },
    })
    syncSnapshot()
    notify()
  }

  function failRun(kind, error, errorInfo) {
    const existing = runs.get(kind)
    if (!existing) return
    runs.set(kind, {
      ...existing,
      status: 'failed',
      finishedAt: Date.now(),
      error: typeof error === 'string' ? error : error?.message || String(error),
      errorInfo: errorInfo || null,
    })
    syncSnapshot()
    notify()
  }

  function clearRun(kind) {
    runs.delete(kind)
    syncSnapshot()
    notify()
  }

  function isRunning(kind) {
    return runs.get(kind)?.status === 'running'
  }

  function getRunningKinds() {
    const running = []
    for (const [kind, run] of runs) {
      if (run.status === 'running') running.push(kind)
    }
    return running
  }

  return {
    subscribe,
    getSnapshot,
    getRun,
    startRun,
    completeRun,
    failRun,
    clearRun,
    isRunning,
    getRunningKinds,
    setDraft,
    getDraft,
    clearDraft,
  }
}

const AnalysisRunsContext = createContext(null)

export function AnalysisRunsProvider({ children }) {
  const [store] = useState(() => createRunStore())

  return (
    <AnalysisRunsContext.Provider value={store}>
      {children}
    </AnalysisRunsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAnalysisRuns() {
  const store = useContext(AnalysisRunsContext)
  if (!store) throw new Error('useAnalysisRuns must be used within AnalysisRunsProvider')

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return {
    runs: snapshot,
    getRun: store.getRun,
    startRun: store.startRun,
    completeRun: store.completeRun,
    failRun: store.failRun,
    clearRun: store.clearRun,
    isRunning: store.isRunning,
    getRunningKinds: store.getRunningKinds,
    setDraft: store.setDraft,
    getDraft: store.getDraft,
    clearDraft: store.clearDraft,
  }
}
