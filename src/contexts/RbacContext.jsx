import { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'

const RbacContext = createContext(null)

export function RbacProvider({ children }) {
  const { user } = useAuth()

  const isAuthenticated = !!user
  const isAdmin = user?.role === 'admin'
  const isClient = user?.role === 'client'
  const isCaseUser = user?.role === 'case_user'

  const value = useMemo(() => ({
    isAuthenticated,
    isAdmin,
    isClient,
    isCaseUser,
    user,
    canManageProjects: isAdmin,
    canViewAllProjects: isAdmin,
    canInviteClients: isAdmin,
    visibleProjects: null,
    canAccessProject(projectId) {
      if (isAdmin) return true
      if (isClient) return user?.projectIds?.includes(projectId) ?? false
      if (isCaseUser) return user?.case_id === projectId
      return false
    },
  }), [isAuthenticated, isAdmin, isClient, isCaseUser, user])

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRbac() {
  const ctx = useContext(RbacContext)
  if (!ctx) throw new Error('useRbac must be used within RbacProvider')
  return ctx
}
