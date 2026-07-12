import { replaceCustomerTerms } from './customerReport'

const SHARE_MANAGERS = new Set([
  'admin',
  'owner',
  'platform_admin',
  'workspace_owner',
  'workspace_admin',
  'project_owner',
  'project_admin',
])

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function addRole(target, value) {
  const role = clean(value).toLowerCase()
  if (role) target.add(role)
}

function projectRole(user, projectRef) {
  const roles = user?.project_roles ?? user?.projectRoles
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return ''
  return roles[projectRef] ?? roles[String(projectRef)] ?? ''
}

/**
 * Share links expose customer data outside the authenticated app. Keep this
 * client gate deliberately narrower than normal report read/export access.
 * The backend remains authoritative and performs the same role check.
 */
export function canManageReportShares(user, projectRef = '') {
  const roles = new Set()
  addRole(roles, user?.role)
  addRole(roles, user?.platform_role ?? user?.platformRole)
  addRole(roles, user?.workspace_role ?? user?.workspaceRole)
  addRole(roles, user?.project_role ?? user?.projectRole)
  addRole(roles, user?.membership?.role)
  addRole(roles, projectRole(user, projectRef))
  return [...roles].some((role) => SHARE_MANAGERS.has(role))
}

/** Final display-only defense for public and printable report copy. */
export function sanitizeSharedReportText(value, fallback = '') {
  const source = String(value ?? '').trim()
  if (!source) return fallback
  return replaceCustomerTerms(source)
    .replace(/(?<![A-Za-z])sessions?(?![A-Za-z])/gi, '訪問')
    .replace(/\bgoogle\s*analytics\s*4\b/gi, 'サイト計測')
    .replace(/\bdataset(?:[ _-]?id)?\b/gi, '接続設定')
    .replace(/API\s*キー/gi, '接続設定')
    .replace(/\bchart(?:[ _-]?id)?[ _-]?\d+\b/gi, '根拠グラフ')
    .replace(/\bnull\b/gi, '未確認')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function customerReportSharePath(token) {
  const normalized = clean(token)
  if (!normalized) throw new TypeError('token is required')
  return `/report-shares/${encodeURIComponent(normalized)}`
}

export function customerReportShareUrl(token, { origin } = {}) {
  const path = customerReportSharePath(token)
  const base = clean(origin) || (typeof window !== 'undefined' ? window.location.origin : '')
  return base ? new URL(path, base).toString() : path
}

export function customerReportPrintPath(projectRef, reportId) {
  const project = clean(projectRef)
  const report = clean(reportId)
  if (!project) throw new TypeError('projectRef is required')
  if (!report) throw new TypeError('reportId is required')
  return `/projects/${encodeURIComponent(project)}/reports/${encodeURIComponent(report)}/print`
}

function reportRows(value) {
  if (Array.isArray(value)) return value
  return Array.isArray(value?.reports) ? value.reports : []
}

/**
 * Resolve the persisted database row without guessing from dates or titles.
 * A contract report id is matched only against the stored report payload.
 */
export function findPersistedReportId(value, report, explicitId = '') {
  const explicit = clean(explicitId)
  if (explicit) return explicit

  const contractId = clean(report?.report_id ?? report?.reportId ?? report?.scope?.report_id)
  const clientEntryId = clean(report?.client_entry_id ?? report?.clientEntryId)
  if (!contractId && !clientEntryId) return null

  const matches = reportRows(value).filter((row) => {
    const storedContractId = clean(
      row?.report?.report_id
        ?? row?.report?.reportId
        ?? row?.report?.scope?.report_id
        ?? row?.reportBundle?.reportV2?.report_id
        ?? row?.reportBundle?.reportV2?.scope?.report_id,
    )
    const storedClientEntryId = clean(row?.client_entry_id ?? row?.clientEntryId)
    return Boolean(
      (contractId && storedContractId === contractId)
      || (clientEntryId && storedClientEntryId === clientEntryId),
    )
  })
  if (matches.length !== 1) return null
  const match = matches[0]
  const isHistoryEntry = Boolean(match?.reportBundle)
  return clean(isHistoryEntry ? match?.serverReportId : match?.id) || null
}
