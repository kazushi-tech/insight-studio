import { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'

const RbacContext = createContext(null)

export function RbacProvider({ children }) {
  const { user } = useAuth()

  // RBAC未導入時（user=null）は全員admin扱い — Phase 1は誰でも見える
  const isAdmin = !user || user.role === 'admin'
  const isClient = user?.role === 'client'

  const value = useMemo(() => ({
    isAdmin,
    isClient,
    user,
    canManageProjects: isAdmin,
    canViewAllProjects: isAdmin,
    canInviteClients: isAdmin,
    visibleProjects: null,
    canAccessProject(projectId) {
      if (isAdmin) return true
      if (isClient) return user?.projectIds?.includes(projectId) ?? false
      return false
    },
  }), [isAdmin, isClient, user])

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRbac() {
  const ctx = useContext(RbacContext)
  if (!ctx) throw new Error('useRbac must be used within RbacProvider')
  return ctx
}
