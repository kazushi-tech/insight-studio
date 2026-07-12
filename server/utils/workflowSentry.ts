import type { ServerRuntimeClientOptions } from '@sentry/core/server'

declare const process: { env: Record<string, string | undefined> }

type SentryEvent = Record<string, unknown>
type SentryClient = {
  captureEvent(event: SentryEvent): string
  flush(timeout?: number): PromiseLike<boolean>
}

const SAFE_TOKEN = /[^A-Za-z0-9_.:-]+/g
let sentryClientPromise: Promise<SentryClient | null> | null = null

function safeToken(value: unknown, fallback: string, limit = 80): string {
  const token = String(value || '').trim().replace(SAFE_TOKEN, '_').slice(0, limit).replace(/^[_.:-]+|[_.:-]+$/g, '')
  return token || fallback
}

function deploymentSha(): string | undefined {
  const value = process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA
  return value ? safeToken(value, 'unknown_release', 64) : undefined
}

function sentryEnvironment(): string {
  return safeToken(
    process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
    'unknown',
    40,
  )
}

export function safeWorkflowErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const constructorName = (error as { constructor?: { name?: unknown } }).constructor?.name
    return safeToken(constructorName, 'WorkflowError')
  }
  return 'WorkflowError'
}

export function sanitizeWorkflowSentryEvent(event: SentryEvent): SentryEvent {
  const rawTags = event.tags && typeof event.tags === 'object'
    ? event.tags as Record<string, unknown>
    : {}
  const errorCode = safeToken(rawTags.error_code, 'workflow_error')
  const exceptionType = safeToken(rawTags.exception_type, 'WorkflowError')
  const tags: Record<string, string> = {
    service: 'workflow',
    error_code: errorCode,
  }
  if (rawTags.stage) tags.stage = safeToken(rawTags.stage, 'unknown_stage')
  const release = deploymentSha()
  if (release) tags.deployment_sha = release

  const sanitized: SentryEvent = {
    platform: 'node',
    level: ['fatal', 'error', 'warning'].includes(String(event.level)) ? event.level : 'error',
    environment: sentryEnvironment(),
    tags,
    fingerprint: ['workflow', errorCode, exceptionType],
    exception: {
      values: [{ type: exceptionType, value: 'Workflow execution failed' }],
    },
  }
  if (release) sanitized.release = release
  const eventId = String(event.event_id || '')
  if (/^[0-9a-fA-F]{32}$/.test(eventId)) sanitized.event_id = eventId.toLowerCase()
  if (typeof event.timestamp === 'number') sanitized.timestamp = event.timestamp
  return sanitized
}

export async function initializeWorkflowSentry(): Promise<SentryClient | null> {
  if (sentryClientPromise) return sentryClientPromise
  sentryClientPromise = (async () => {
    const dsn = String(process.env.WORKFLOW_SENTRY_DSN || process.env.SENTRY_DSN || '').trim()
    if (!dsn) return null
    try {
      const Sentry = await import('@sentry/core/server')
      const options: ServerRuntimeClientOptions = {
        dsn,
        environment: sentryEnvironment(),
        release: deploymentSha(),
        integrations: [],
        stackParser: () => [],
        transport: (options) => Sentry.createTransport(options, async (request) => {
          try {
            const response = await fetch(options.url, {
              method: 'POST',
              headers: {
                ...options.headers,
                'Content-Type': 'application/x-sentry-envelope',
              },
              body: request.body as BodyInit,
            })
            return {
              statusCode: response.status,
              headers: {
                'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
                'retry-after': response.headers.get('retry-after'),
              },
            }
          } catch {
            return { statusCode: 0 }
          }
        }),
        sendDefaultPii: false,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          queryParams: false,
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false,
          frameContextLines: 0,
        },
        tracesSampleRate: 0.0,
        beforeSend: (event) => (
          sanitizeWorkflowSentryEvent(event as unknown as SentryEvent) as unknown as typeof event
        ),
        beforeSendTransaction: () => null,
        attachStacktrace: false,
        serverName: 'redacted',
        sendClientReports: false,
        enableLogs: false,
      }
      const client = Sentry.initAndBind(Sentry.ServerRuntimeClient, options)
      return client as SentryClient
    } catch {
      console.error(JSON.stringify({
        level: 'error',
        event: 'sentry_initialization_failed',
        service: 'workflow',
        error_code: 'invalid_monitoring_configuration',
      }))
      return null
    }
  })()
  return sentryClientPromise
}

export async function captureWorkflowException(
  error: unknown,
  errorCode: string,
  stage: string,
): Promise<void> {
  const client = await initializeWorkflowSentry()
  if (!client) return
  const code = safeToken(errorCode, 'workflow_error')
  const exceptionType = safeWorkflowErrorCode(error)
  try {
    client.captureEvent({
      level: 'error',
      tags: {
        service: 'workflow',
        error_code: code,
        exception_type: exceptionType,
        stage: safeToken(stage, 'workflow_runtime'),
      },
      exception: {
        values: [{ type: exceptionType, value: 'Workflow execution failed' }],
      },
    })
    await client.flush(1_000)
  } catch {
    // Monitoring must never change the Workflow or API result.
  }
}
