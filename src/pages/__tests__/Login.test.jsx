import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../Login'

const loginAds = vi.fn()
const loginWithCase = vi.fn()
const loginCase = vi.fn()
const getCaseTrustToken = vi.fn()
const warmAdsInsightsBackend = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    loginAds,
    loginWithCase,
    user: null,
  }),
}))

vi.mock('../../api/adsInsights', () => ({
  loginCase: (...args) => loginCase(...args),
  getCaseTrustToken: (...args) => getCaseTrustToken(...args),
  warmAdsInsightsBackend: (...args) => warmAdsInsightsBackend(...args),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear()
    loginAds.mockReset()
    loginWithCase.mockReset()
    loginCase.mockReset()
    getCaseTrustToken.mockReset()
    warmAdsInsightsBackend.mockReset()
    getCaseTrustToken.mockReturnValue(null)
    warmAdsInsightsBackend.mockResolvedValue(false)
  })

  it('keeps the login screen simple and sends one password-only case request', async () => {
    const user = userEvent.setup()
    localStorage.setItem('insight-studio-current-case', JSON.stringify({ case_id: 'demo' }))
    loginCase.mockResolvedValue({
      ok: true,
      case_id: 'demo',
      name: 'Demo',
      dataset_id: 'analytics_demo',
      token: 'case-token',
    })

    renderLogin()

    expect(screen.queryByText('ログイン種別')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('パスワード'), 'case-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginCase).toHaveBeenCalledWith('', 'case-password', { deviceTrustToken: null })
    })
    expect(loginAds).not.toHaveBeenCalled()
    expect(loginCase).toHaveBeenCalledTimes(1)
    expect(loginWithCase).toHaveBeenCalledWith(expect.objectContaining({ case_id: 'demo' }))
  })

  it('explains the customer login and provides public preview and consultation paths', () => {
    renderLogin()

    expect(screen.getByRole('heading', { name: 'ご利用画面へログイン' })).toBeInTheDocument()
    expect(screen.getByText(/導入時に発行されたパスワード/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '画面サンプルを見る' })).toHaveAttribute('href', '/lp#product-preview')
    expect(screen.getByRole('link', { name: /導入条件を相談する/ })).toHaveAttribute('href', 'https://www.petabit.co.jp/contact/')
    expect(screen.getByRole('button', { name: 'パスワードを表示' })).toBeInTheDocument()
  })

  it('falls back to admin login when no case password matches', async () => {
    const user = userEvent.setup()
    loginCase.mockRejectedValue({ status: 401 })
    loginAds.mockResolvedValue({ token: 'admin-token' })

    renderLogin()

    await user.type(screen.getByLabelText('パスワード'), 'admin-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginAds).toHaveBeenCalledWith('admin-password')
    })
    expect(loginCase).toHaveBeenCalledTimes(1)
  })
})
