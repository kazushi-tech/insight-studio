import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_PROVIDER_GEMINI,
  DEFAULT_GEMINI_MODEL,
  getAnalysisModel,
} from '../analysisProvider'

describe('analysisProvider Gemini defaults', () => {
  it('uses Gemini 3.1 Flash-Lite for Gemini analysis requests', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.1-flash-lite')
    expect(getAnalysisModel(ANALYSIS_PROVIDER_GEMINI)).toBe('gemini-3.1-flash-lite')
  })
})
