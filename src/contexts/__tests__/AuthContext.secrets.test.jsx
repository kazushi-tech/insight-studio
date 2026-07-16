import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'

vi.mock('../../api/adsInsights', () => ({
  login: vi.fn(),
  loginWithEmail: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(() => null),
  logout: vi.fn(),
  setOnAuthError: vi.fn(),
  setAuthTokenProvider: vi.fn(),
}))

vi.mock('../../api/marketLens', () => ({
  setMarketLensAuthTokenProvider: vi.fn(),
}))

vi.mock('../../api/projectReports', () => ({
  setProjectReportsAuthTokenProvider: vi.fn(),
}))

vi.mock('../../api/platform', () => ({
  setPlatformAuthTokenProvider: vi.fn(),
}))

vi.mock('../../api/billing', () => ({
  setBillingAuthTokenProvider: vi.fn(),
}))

vi.mock('../../api/legal', () => ({
  setLegalAuthTokenProvider: vi.fn(),
}))

function SecretProbe() {
  const {
    geminiKey,
    setGeminiKey,
    claudeKey,
    setClaudeKey,
    logoutAds,
    isAdsAuthenticated,
  } = useAuth()
  return (
    <div>
      <output aria-label="authenticated">{String(isAdsAuthenticated)}</output>
      <output aria-label="gemini-key">{geminiKey}</output>
      <output aria-label="claude-key">{claudeKey}</output>
      <button onClick={() => setGeminiKey('AIza-session-only-key')}>Geminiを設定</button>
      <button onClick={() => setClaudeKey('sk-ant-session-only-key')}>Claudeを設定</button>
      <button onClick={logoutAds}>ログアウト</button>
    </div>
  )
}

function CaseProbe() {
  const { user, loginWithCase, isAdsAuthenticated } = useAuth()
  return (
    <div>
      <output aria-label="case-user">{user ? JSON.stringify(user) : ''}</output>
      <output aria-label="case-authenticated">{String(isAdsAuthenticated)}</output>
      <button onClick={() => loginWithCase({
        case_id: 'demo',
        name: 'Insight Studio デモ',
        dataset_id: 'demo_portfolio_dataset',
        token: 'demo-token',
        is_demo: true,
      })}>
        デモ案件でログイン
      </button>
    </div>
  )
}

describe('AuthContext analysis secrets', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('loads analysis keys only from sessionStorage and removes legacy persistent keys', () => {
    localStorage.setItem('is_ads_token', 'unsafe-persistent-jwt')
    localStorage.setItem('is_gemini_key', 'AIza-legacy-persistent-key')
    localStorage.setItem('is_claude_key', 'sk-ant-legacy-persistent-key')
    sessionStorage.setItem('is_gemini_key', 'AIza-current-session-key')

    render(<AuthProvider><SecretProbe /></AuthProvider>)

    expect(screen.getByLabelText('gemini-key')).toHaveTextContent('AIza-current-session-key')
    expect(screen.getByLabelText('claude-key')).toBeEmptyDOMElement()
    expect(localStorage.getItem('is_gemini_key')).toBeNull()
    expect(localStorage.getItem('is_claude_key')).toBeNull()
    expect(localStorage.getItem('is_ads_token')).toBeNull()
    expect(screen.getByLabelText('authenticated')).toHaveTextContent('false')
  })

  it('discards a stale legacy user when a reload has no in-memory token', () => {
    localStorage.setItem('is_ads_token', 'unsafe-persistent-jwt')
    localStorage.setItem('is_user', JSON.stringify({
      role: 'case_user',
      case_id: 'stale-case',
      display_name: '古い利用者',
    }))

    render(<AuthProvider><CaseProbe /></AuthProvider>)

    expect(screen.getByLabelText('case-user')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('case-authenticated')).toHaveTextContent('false')
    expect(localStorage.getItem('is_ads_token')).toBeNull()
    expect(localStorage.getItem('is_user')).toBeNull()
  })

  it('stores newly entered analysis keys in sessionStorage only', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><SecretProbe /></AuthProvider>)

    await user.click(screen.getByRole('button', { name: 'Geminiを設定' }))
    await user.click(screen.getByRole('button', { name: 'Claudeを設定' }))

    expect(sessionStorage.getItem('is_gemini_key')).toBe('AIza-session-only-key')
    expect(sessionStorage.getItem('is_claude_key')).toBe('sk-ant-session-only-key')
    expect(localStorage.getItem('is_gemini_key')).toBeNull()
    expect(localStorage.getItem('is_claude_key')).toBeNull()
  })

  it('clears analysis keys from memory and session storage on logout', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><SecretProbe /></AuthProvider>)

    await user.click(screen.getByRole('button', { name: 'Geminiを設定' }))
    await user.click(screen.getByRole('button', { name: 'Claudeを設定' }))
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))

    expect(screen.getByLabelText('gemini-key')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('claude-key')).toBeEmptyDOMElement()
    expect(sessionStorage.getItem('is_gemini_key')).toBeNull()
    expect(sessionStorage.getItem('is_claude_key')).toBeNull()
  })

  it('persists the verified case demo flag with the case user', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><CaseProbe /></AuthProvider>)

    await user.click(screen.getByRole('button', { name: 'デモ案件でログイン' }))

    expect(screen.getByLabelText('case-user')).toHaveTextContent('"is_demo":true')
    expect(screen.getByLabelText('case-authenticated')).toHaveTextContent('true')
    expect(localStorage.getItem('is_ads_token')).toBeNull()
    expect(JSON.parse(localStorage.getItem('is_user'))).toEqual(expect.objectContaining({
      role: 'case_user',
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }))
  })
})
