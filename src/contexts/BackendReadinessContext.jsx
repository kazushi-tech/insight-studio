import { useSyncExternalStore, useEffect } from 'react'
import {
  subscribeBackendReadiness,
  getBackendReadinessSnapshot,
  startBackendKeepAlive,
  stopBackendKeepAlive,
} from '../api/marketLens'

// eslint-disable-next-line react-refresh/only-export-components
export function useBackendReadiness() {
  return useSyncExternalStore(subscribeBackendReadiness, getBackendReadinessSnapshot)
}

export function BackendReadinessProvider({ children }) {
  useEffect(() => {
    startBackendKeepAlive()
    return () => stopBackendKeepAlive()
  }, [])

  return children
}
