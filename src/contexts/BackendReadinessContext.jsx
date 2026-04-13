import { useSyncExternalStore, useEffect } from 'react'
import {
  subscribeBackendReadiness,
  getBackendReadinessSnapshot,
  startBackendKeepAlive,
  stopBackendKeepAlive,
} from '../api/marketLens'

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
