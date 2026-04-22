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

  // Compare: scan (legacy sync endpoint kept for backward compat)
  http.post(`${ML_ORIGIN}/api/scan`, () =>
    HttpResponse.json(compareFixture),
  ),
  http.post('/api/ml/scan', () =>
    HttpResponse.json(compareFixture),
  ),

  // Compare: async scan job — create
  http.post(`${ML_ORIGIN}/api/scan/jobs`, () =>
    HttpResponse.json({
      job_id: 'scan-job-001',
      poll_url: '/scan/jobs/scan-job-001',
      retry_after_sec: 3,
      status: 'running',
      stage: 'queued',
    }),
  ),
  http.post('/api/ml/scan/jobs', () =>
    HttpResponse.json({
      job_id: 'scan-job-001',
      poll_url: '/scan/jobs/scan-job-001',
      retry_after_sec: 3,
      status: 'running',
      stage: 'queued',
    }),
  ),

  // Compare: async scan job — poll (returns completed with fixture)
  http.get(`${ML_ORIGIN}/api/scan/jobs/:jobId`, () =>
    HttpResponse.json({
      status: 'completed',
      stage: 'complete',
      progress_pct: 100,
      updated_at: new Date().toISOString(),
      result: compareFixture,
    }),
  ),
  http.get('/api/ml/scan/jobs/:jobId', () =>
    HttpResponse.json({
      status: 'completed',
      stage: 'complete',
      progress_pct: 100,
      updated_at: new Date().toISOString(),
      result: compareFixture,
    }),
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
