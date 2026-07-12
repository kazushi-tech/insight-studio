import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'nitro/h3'

export function requireWorkflowSuitabilityAccess(event: H3Event) {
  if (process.env.WORKFLOW_SUITABILITY_ENABLED !== 'true' || process.env.VERCEL_ENV !== 'preview') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const expected = process.env.WORKFLOW_SUITABILITY_TOKEN || ''
  const supplied = getHeader(event, 'x-workflow-suitability-token') || ''
  if (expected.length < 32 || supplied.length !== expected.length) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  if (!timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}

export function requireOpaqueId(value: unknown, label: string) {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: `${label} is invalid` })
  }
  return normalized
}
