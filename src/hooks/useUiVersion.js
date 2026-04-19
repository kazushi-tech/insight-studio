import { useEffect, useState } from 'react'

/**
 * Resolves the active report UI version.
 *
 * Priority: query param `?ui=v2|v1` → localStorage `reportUiVersion` → default `v1`.
 * Writing a new value via `setUiVersion` persists to localStorage and updates
 * the URL query param so reloads and share-links stay consistent.
 */

const STORAGE_KEY = 'reportUiVersion'
const VALID = new Set(['v1', 'v2'])
const DEFAULT = 'v2'

function readFromQuery() {
  if (typeof window === 'undefined') return null
  try {
    const value = new URLSearchParams(window.location.search).get('ui')
    return value && VALID.has(value) ? value : null
  } catch {
    return null
  }
}

function readFromStorage() {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && VALID.has(value) ? value : null
  } catch {
    return null
  }
}

export function resolveUiVersion() {
  return readFromQuery() ?? readFromStorage() ?? DEFAULT
}

export function useUiVersion() {
  const [version, setVersion] = useState(resolveUiVersion)

  useEffect(() => {
    const onPopState = () => setVersion(resolveUiVersion())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const setUiVersion = (next) => {
    if (!VALID.has(next)) return
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage disabled — ignore */
    }
    try {
      const url = new URL(window.location.href)
      if (next === DEFAULT) {
        url.searchParams.delete('ui')
      } else {
        url.searchParams.set('ui', next)
      }
      window.history.replaceState({}, '', url)
    } catch {
      /* non-browser env */
    }
    setVersion(next)
  }

  return { version, setUiVersion, isV2: version === 'v2' }
}
