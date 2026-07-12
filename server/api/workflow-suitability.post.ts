import { defineEventHandler, readBody, setResponseStatus } from 'nitro/h3'
import { start } from 'workflow/api'

import { requireOpaqueId, requireWorkflowSuitabilityAccess } from '../utils/workflowSuitabilityAuth'
import { captureWorkflowException } from '../utils/workflowSentry'
import { workflowSuitability } from '../../workflows/workflow-suitability'

export default defineEventHandler(async (event) => {
  requireWorkflowSuitabilityAccess(event)
  const body = await readBody<{ job_id?: string }>(event)
  const jobId = requireOpaqueId(body?.job_id, 'job_id')
  try {
    const run = await start(workflowSuitability, [jobId])
    setResponseStatus(event, 202)
    return { ok: true, run_id: run.runId, status: 'accepted' }
  } catch (error) {
    await captureWorkflowException(error, 'workflow_start_failed', 'start_api')
    throw error
  }
})
