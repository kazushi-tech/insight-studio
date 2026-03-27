import { createContext, useContext, useMemo, useState } from 'react'

const UserProfileContext = createContext(null)

const STORAGE_KEY_DISPLAY_NAME = 'insight-studio-display-name'
const DEFAULT_DISPLAY_NAME = 'オペレーター'

function normalizeDisplayName(value) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return normalized || DEFAULT_DISPLAY_NAME
}

function getAvatarInitial(displayName) {
  return Array.from(normalizeDisplayName(displayName))[0] || Array.from(DEFAULT_DISPLAY_NAME)[0]
}

export function UserProfileProvider({ children }) {
  const [displayName, setDisplayNameState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_DISPLAY_NAME
    return normalizeDisplayName(window.localStorage.getItem(STORAGE_KEY_DISPLAY_NAME))
  })

  function setDisplayName(nextName) {
    const normalized = normalizeDisplayName(nextName)
    setDisplayNameState(normalized)
    window.localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, normalized)
  }

  const value = useMemo(
    () => ({
      displayName,
      setDisplayName,
      avatarInitial: getAvatarInitial(displayName),
    }),
    [displayName],
  )

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUserProfile() {
  const ctx = useContext(UserProfileContext)
  if (!ctx) throw new Error('useUserProfile must be used within UserProfileProvider')
  return ctx
}
