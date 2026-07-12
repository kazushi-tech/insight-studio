import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { getRun } from 'workflow/api'

import { requireOpaqueId, requireWorkflowSuitabilityAccess } from '../../utils/workflowSuitabilityAuth'
import { captureWorkflowException } from '../../utils/workflowSentry'

export default defineEventHandler(async (event) => {
  requireWorkflowSuitabilityAccess(event)
  const runId = requireOpaqueId(getRouterParam(event, 'runId'), 'run_id')
  try {
    const run = getRun(runId)
    return { ok: true, run_id: runId, status: await run.status }
  } catch (error) {
    await captureWorkflowException(error, 'workflow_status_failed', 'status_api')
    throw error
  }
})
