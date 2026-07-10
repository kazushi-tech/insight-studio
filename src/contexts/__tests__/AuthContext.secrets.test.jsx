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
}))

function SecretProbe() {
  const { geminiKey, setGeminiKey, claudeKey, setClaudeKey, logoutAds } = useAuth()
  return (
    <div>
      <output aria-label="gemini-key">{geminiKey}</output>
      <output aria-label="claude-key">{claudeKey}</output>
      <button onClick={() => setGeminiKey('AIza-session-only-key')}>Geminiを設定</button>
      <button onClick={() => setClaudeKey('sk-ant-session-only-key')}>Claudeを設定</button>
      <button onClick={logoutAds}>ログアウト</button>
    </div>
  )
}

describe('AuthContext analysis secrets', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('loads analysis keys only from sessionStorage and removes legacy persistent keys', () => {
    localStorage.setItem('is_gemini_key', 'AIza-legacy-persistent-key')
    localStorage.setItem('is_claude_key', 'sk-ant-legacy-persistent-key')
    sessionStorage.setItem('is_gemini_key', 'AIza-current-session-key')

    render(<AuthProvider><SecretProbe /></AuthProvider>)

    expect(screen.getByLabelText('gemini-key')).toHaveTextContent('AIza-current-session-key')
    expect(screen.getByLabelText('claude-key')).toBeEmptyDOMElement()
    expect(localStorage.getItem('is_gemini_key')).toBeNull()
    expect(localStorage.getItem('is_claude_key')).toBeNull()
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
})
