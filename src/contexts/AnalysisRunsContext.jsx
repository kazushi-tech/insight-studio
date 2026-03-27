import { createContext, useContext, useCallback, useRef, useSyncExternalStore } from 'react'

// ─── Run kinds ───
// compare | discovery | creative-review | banner-generation

function createRunStore() {
  const runs = new Map()
  const listeners = new Set()

  function notify() {
    listeners.forEach((fn) => fn())
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function getSnapshot() {
    return Object.fromEntries(runs)
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
      result: null,
      error: null,
      meta: {},
    }
    runs.set(kind, run)
    notify()
    return run
  }

  function completeRun(kind, result, meta = {}) {
    const existing = runs.get(kind)
    if (!existing) return
    runs.set(kind, {
      ...existing,
      status: 'completed',
      result,
      meta: { ...existing.meta, ...meta },
    })
    notify()
  }

  function failRun(kind, error) {
    const existing = runs.get(kind)
    if (!existing) return
    runs.set(kind, {
      ...existing,
      status: 'failed',
      error: typeof error === 'string' ? error : error?.message || String(error),
    })
    notify()
  }

  function clearRun(kind) {
    runs.delete(kind)
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
  }
}

const AnalysisRunsContext = createContext(null)

export function AnalysisRunsProvider({ children }) {
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = createRunStore()
  }

  return (
    <AnalysisRunsContext.Provider value={storeRef.current}>
      {children}
    </AnalysisRunsContext.Provider>
  )
}

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
  }
}
