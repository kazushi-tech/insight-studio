import { describe, expect, it } from 'vitest'

import {
  safeWorkflowErrorCode,
  sanitizeWorkflowSentryEvent,
} from '../../../server/utils/workflowSentry'


describe('privacy-safe Workflow Sentry events', () => {
  it('rebuilds events without request, identity, URL, source, locals, or secret values', () => {
    const event = sanitizeWorkflowSentryEvent({
      event_id: 'a'.repeat(32),
      level: 'error',
      request: { url: 'https://private.example/path?token=secret' },
      user: { email: 'person@example.com', ip_address: '10.0.0.1' },
      breadcrumbs: [{ message: 'sk-secret' }],
      contexts: { runtime: { path: '/var/task/private.ts' } },
      extra: { dataset: 'customer_dataset', jwt: 'header.payload.signature' },
      tags: {
        error_code: 'workflow_status_failed',
        exception_type: 'RuntimeError',
        stage: 'status_api',
        job_id: 'private-job-id',
      },
      exception: {
        values: [{
          type: 'RuntimeError',
          value: 'provider response body',
          stacktrace: { frames: [{ filename: '/var/task/private.ts', vars: { api_key: 'secret' } }] },
        }],
      },
    })
    const encoded = JSON.stringify(event)
    for (const forbidden of [
      'private.example',
      'person@example.com',
      '10.0.0.1',
      'sk-secret',
      'customer_dataset',
      'header.payload.signature',
      'private-job-id',
      '/var/task/private.ts',
      'api_key',
      'provider response body',
      'stacktrace',
    ]) {
      expect(encoded).not.toContain(forbidden)
    }
    expect(event.tags).toMatchObject({
      service: 'workflow',
      error_code: 'workflow_status_failed',
      stage: 'status_api',
    })
    expect(event.exception).toEqual({
      values: [{ type: 'RuntimeError', value: 'Workflow execution failed' }],
    })
  })

  it('derives only an opaque class code and never an error message', () => {
    class ProviderFailure extends Error {}
    const error = new ProviderFailure('https://private.example customer_dataset sk-secret')
    expect(safeWorkflowErrorCode(error)).toBe('ProviderFailure')
    expect(safeWorkflowErrorCode('header.payload.signature')).toBe('WorkflowError')
  })
})
