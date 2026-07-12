import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BillingSettingsCard from '../BillingSettingsCard'


const api = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}))

vi.mock('../../api/billing', () => ({ billingApi: api }))

beforeEach(() => {
  vi.clearAllMocks()
  api.getSubscription.mockResolvedValue({
    ok: true,
    subscription: {
      access: 'full',
      status: 'managed_pilot',
      plan_key: 'managed_pilot',
      transition_at: null,
    },
  })
})

describe('BillingSettingsCard', () => {
  it('shows a safe managed-pilot state only to a billing manager', async () => {
    render(<BillingSettingsCard enabled user={{ workspace_role: 'workspace_owner' }} />)
    expect(await screen.findByText('有料パイロット')).toBeInTheDocument()
    expect(screen.getByText('すべて利用できます')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '請求・解約を管理' })).toBeDisabled()
    expect(screen.getByText(/自動課金へ切り替わりません/)).toBeInTheDocument()
    expect(api.getSubscription).toHaveBeenCalledTimes(1)
  })

  it('does not expose billing controls to project members', async () => {
    const { container } = render(
      <BillingSettingsCard enabled user={{ project_role: 'project_editor' }} />,
    )
    await waitFor(() => expect(api.getSubscription).not.toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a safe retry state without provider details', async () => {
    api.getSubscription.mockRejectedValue(new Error('Stripe secret sk_live_should_not_leak'))
    render(<BillingSettingsCard enabled user={{ platform_role: 'platform_admin' }} />)
    expect(await screen.findByText('契約状況を確認できませんでした。少し待って再試行してください。')).toBeInTheDocument()
    expect(screen.queryByText(/sk_live/)).not.toBeInTheDocument()
  })
})
