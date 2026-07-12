import { createContext, useContext, useMemo } from 'react'
import { useAuth } from './AuthContext'

const RbacContext = createContext(null)
const EMPTY_PROJECT_ROLES = Object.freeze({})

export function RbacProvider({ children }) {
  const { user } = useAuth()

  const isAuthenticated = !!user
  const platformRole = user?.platform_role ?? null
  const workspaceRole = user?.workspace_role ?? null
  const projectRoles = user?.project_roles ?? EMPTY_PROJECT_ROLES
  // Advanced market analysis stays operator-only. Workspace owners are not
  // silently promoted to platform operators.
  const isAdmin = ['admin', 'operator'].includes(user?.role) || platformRole === 'platform_admin'
  const isClient = user?.role === 'client'
  const isCaseUser = user?.role === 'case_user'
  const canManageWorkspace = isAdmin
    || workspaceRole === 'workspace_owner'
    || workspaceRole === 'workspace_admin'
  const canManageBilling = isAdmin || workspaceRole === 'workspace_owner'

  const value = useMemo(() => ({
    isAuthenticated,
    isAdmin,
    isClient,
    isCaseUser,
    platformRole,
    workspaceRole,
    projectRoles,
    user,
    canManageWorkspace,
    canManageBilling,
    canManageProjects: canManageWorkspace,
    canViewAllProjects: canManageWorkspace,
    canInviteClients: canManageWorkspace,
    visibleProjects: null,
    canAccessProject(projectId) {
      if (isAdmin) return true
      if (canManageWorkspace) return true
      if (projectRoles?.[projectId]) return true
      if (isClient) return user?.projectIds?.includes(projectId) ?? false
      if (isCaseUser) return user?.case_id === projectId
      return false
    },
    canEditProject(projectId) {
      if (canManageWorkspace) return true
      return projectRoles?.[projectId] === 'project_editor'
    },
  }), [
    canManageBilling,
    canManageWorkspace,
    isAdmin,
    isAuthenticated,
    isCaseUser,
    isClient,
    platformRole,
    projectRoles,
    user,
    workspaceRole,
  ])

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRbac() {
  const ctx = useContext(RbacContext)
  if (!ctx) throw new Error('useRbac must be used within RbacProvider')
  return ctx
}
