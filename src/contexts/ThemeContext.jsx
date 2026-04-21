import { createContext, useContext, useEffect, useState } from 'react'

// eslint-disable-next-line react-refresh/only-export-components
export const ThemeContext = createContext(null)

const STORAGE_KEY_THEME = 'insight-studio-theme'
const DEFAULT_THEME = 'light'

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : DEFAULT_THEME
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME
    return normalizeTheme(window.localStorage.getItem(STORAGE_KEY_THEME))
  })

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(STORAGE_KEY_THEME, theme)
  }, [theme])

  function setTheme(nextTheme) {
    setThemeState(normalizeTheme(nextTheme))
  }

  function toggleTheme() {
    setThemeState((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
