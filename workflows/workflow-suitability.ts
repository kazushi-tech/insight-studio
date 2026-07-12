import { getStepMetadata, RetryableError, sleep } from 'workflow'

import { captureWorkflowException } from '../server/utils/workflowSentry'

/**
 * Preview-only platform suitability probe. The serialized payload is only a
 * database job id: URLs, credentials, datasets and extracted content remain in
 * server-side environment/configuration and never enter the Workflow event log.
 */
export async function workflowSuitability(jobId: string) {
  'use workflow'

  try {
    const retry = await retryProbe(jobId)
    await sleep('6m')
    const artifact = await deterministicArtifact(jobId)
    return { job_id: jobId, status: 'completed', retry, artifact }
  } catch (error) {
    await reportWorkflowFailure()
    throw error
  }
}

async function reportWorkflowFailure() {
  'use step'
  await captureWorkflowException(
    null,
    'workflow_run_failed',
    'workflow_run',
  )
}

reportWorkflowFailure.maxRetries = 1

async function retryProbe(jobId: string) {
  'use step'
  const metadata = getStepMetadata()
  if (metadata.attempt <= 1) {
    throw new RetryableError('preview_probe_retry', { retryAfter: 250 })
  }
  return { job_id: jobId, attempts: metadata.attempt + 1 }
}

retryProbe.maxRetries = 2

async function deterministicArtifact(jobId: string) {
  'use step'
  return { id: `suitability-artifact-${jobId}`, count: 1 }
}

deterministicArtifact.maxRetries = 2
