import { defineEventHandler, getRouterParam } from 'nitro/h3'
import { getRun } from 'workflow/api'

import { requireOpaqueId, requireWorkflowSuitabilityAccess } from '../../../utils/workflowSuitabilityAuth'
import { captureWorkflowException } from '../../../utils/workflowSentry'

export default defineEventHandler(async (event) => {
  requireWorkflowSuitabilityAccess(event)
  const runId = requireOpaqueId(getRouterParam(event, 'runId'), 'run_id')
  try {
    await getRun(runId).cancel()
    return { ok: true, run_id: runId, status: 'cancelled' }
  } catch (error) {
    await captureWorkflowException(error, 'workflow_cancel_failed', 'cancel_api')
    throw error
  }
})
