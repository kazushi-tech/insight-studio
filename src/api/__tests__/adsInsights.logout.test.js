import { beforeEach, describe, expect, it } from 'vitest'

import { logout } from '../adsInsights'

describe('Ads Insights logout data retention', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('purges customer reports, setup, run drafts, and analysis secrets', () => {
    localStorage.setItem('insight-studio-ads-report-history:case-a', '[{"id":"report-a"}]')
    localStorage.setItem('insight-studio-ads-setup:case-a', '{"datasetId":"dataset-a"}')
    localStorage.setItem('insight-studio-current-case', '{"case_id":"case-a"}')
    localStorage.setItem('is_case_trust_case-a', 'trust-token')
    localStorage.setItem('is-score-history', '{"compare":[]}')
    localStorage.setItem('insight-studio-theme', 'light')
    sessionStorage.setItem('is-draft-ai-explorer', '{"messages":[]}')
    sessionStorage.setItem('is_gemini_key', 'AI' + 'za-test-only')
    sessionStorage.setItem('is_claude_key', 'sk-' + 'ant-test-only')

    logout()

    expect(localStorage.getItem('insight-studio-ads-report-history:case-a')).toBeNull()
    expect(localStorage.getItem('insight-studio-ads-setup:case-a')).toBeNull()
    expect(localStorage.getItem('insight-studio-current-case')).toBeNull()
    expect(localStorage.getItem('is_case_trust_case-a')).toBeNull()
    expect(localStorage.getItem('is-score-history')).toBeNull()
    expect(sessionStorage.getItem('is-draft-ai-explorer')).toBeNull()
    expect(sessionStorage.getItem('is_gemini_key')).toBeNull()
    expect(sessionStorage.getItem('is_claude_key')).toBeNull()
    expect(localStorage.getItem('insight-studio-theme')).toBe('light')
  })
})
