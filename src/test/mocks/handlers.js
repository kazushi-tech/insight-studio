import { http, HttpResponse } from 'msw'
import discoveryFixture from '../fixtures/discovery.json'
import compareFixture from '../fixtures/compare.json'

const ML_ORIGIN = 'https://market-lens-ai.onrender.com'

// ─── Default happy-path handlers ─────────────────────────────
export const handlers = [
  // Health check
  http.get(`${ML_ORIGIN}/api/health`, () =>
    HttpResponse.json({ status: 'ok' }),
  ),
  http.get('/api/ml/health', () =>
    HttpResponse.json({ status: 'ok' }),
  ),

  // Discovery: create job
  http.post(`${ML_ORIGIN}/api/discovery/jobs`, () =>
    HttpResponse.json({
      job_id: 'test-job-001',
      stage: 'queued',
      poll_url: '/discovery/jobs/test-job-001',
      retry_after_sec: 2,
      status: 'running',
    }),
  ),
  http.post('/api/ml/discovery/jobs', () =>
    HttpResponse.json({
      job_id: 'test-job-001',
      stage: 'queued',
      poll_url: '/discovery/jobs/test-job-001',
      retry_after_sec: 2,
      status: 'running',
    }),
  ),

  // Discovery: poll job status (returns completed)
  http.get(`${ML_ORIGIN}/api/discovery/jobs/:jobId`, () =>
    HttpResponse.json(discoveryFixture),
  ),
  http.get('/api/ml/discovery/jobs/:jobId', () =>
    HttpResponse.json(discoveryFixture),
  ),

  // Compare: scan
  http.post(`${ML_ORIGIN}/api/scan`, () =>
    HttpResponse.json(compareFixture),
  ),
  http.post('/api/ml/scan', () =>
    HttpResponse.json(compareFixture),
  ),

  // Scan history
  http.get(`${ML_ORIGIN}/api/scans`, () =>
    HttpResponse.json({ scans: [] }),
  ),
  http.get('/api/ml/scans', () =>
    HttpResponse.json({ scans: [] }),
  ),

  // Scan detail
  http.get(`${ML_ORIGIN}/api/scans/:runId`, ({ params }) =>
    HttpResponse.json({ ...compareFixture, run_id: params.runId }),
  ),
  http.get('/api/ml/scans/:runId', ({ params }) =>
    HttpResponse.json({ ...compareFixture, run_id: params.runId }),
  ),
]
