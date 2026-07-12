import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import LegalPrivacySettingsCard from '../LegalPrivacySettingsCard'
import { legalApi } from '../../api/legal'

vi.mock('../../api/legal', () => ({
  legalApi: {
    getDocuments: vi.fn(),
    getAcceptanceStatus: vi.fn(),
    listDeletionRequests: vi.fn(),
    listDataExports: vi.fn(),
    acceptDocument: vi.fn(),
    requestDataExport: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    downloadDataExport: vi.fn(),
  },
}))

const DOCUMENT = {
  document_key: 'terms',
  title: '利用規約',
  version: '2026-07-12',
  effective_at: '2026-07-12T00:00:00Z',
  public_url: 'https://legal.example.test/terms',
}

function ready({ accepted = false, deletions = [], exports = [] } = {}) {
  legalApi.getDocuments.mockResolvedValue({ documents: [DOCUMENT] })
  legalApi.getAcceptanceStatus.mockResolvedValue({
    documents: [{ document_key: 'terms', accepted }],
  })
  legalApi.listDeletionRequests.mockResolvedValue({ deletion_requests: deletions })
  legalApi.listDataExports.mockResolvedValue({ exports })
}

describe('LegalPrivacySettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ready()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('records explicit acceptance for the displayed document version', async () => {
    const user = userEvent.setup()
    legalApi.acceptDocument.mockResolvedValue({ ok: true })
    render(<LegalPrivacySettingsCard enabled user={{ workspace_role: 'workspace_owner' }} />)

    expect(await screen.findByRole('heading', { name: '利用規約' })).toBeInTheDocument()
    const acceptButton = screen.getByRole('button', { name: '同意を記録' })
    expect(acceptButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '最新版を確認し、同意します' }))
    await user.click(acceptButton)

    await waitFor(() => {
      expect(legalApi.acceptDocument).toHaveBeenCalledWith(
        'terms',
        '2026-07-12',
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^accept-terms:/) }),
      )
    })
  })

  it('limits workspace export and deletion controls to owners', async () => {
    const { rerender } = render(
      <LegalPrivacySettingsCard enabled user={{ project_role: 'project_editor' }} />,
    )
    await screen.findByRole('heading', { name: '利用規約' })
    expect(screen.queryByRole('button', { name: '企業全体を申請' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '企業全体の削除を申請' })).not.toBeInTheDocument()

    rerender(<LegalPrivacySettingsCard enabled user={{ workspace_role: 'workspace_owner' }} />)
    expect(await screen.findByRole('button', { name: '企業全体を申請' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '企業全体の削除を申請' })).toBeInTheDocument()
  })

  it('requests account export without exposing implementation details', async () => {
    const user = userEvent.setup()
    legalApi.requestDataExport.mockResolvedValue({ ok: true })
    render(<LegalPrivacySettingsCard enabled user={{ project_role: 'project_viewer' }} />)
    await user.click(await screen.findByRole('button', { name: '自分のデータを申請' }))

    await waitFor(() => expect(legalApi.requestDataExport).toHaveBeenCalledWith(
      'account',
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^export-account:/) }),
    ))
    expect(screen.getByRole('status')).toHaveTextContent('データ出力を受け付けました')
    expect(screen.queryByText(/audit_events|workspace_id|API|dataset/i)).not.toBeInTheDocument()
  })

  it('shows and cancels a deletion during the 30-day grace period', async () => {
    ready({
      accepted: true,
      deletions: [{
        id: 'delete-1',
        scope: 'account',
        status: 'requested',
        execute_after: '2026-08-11T00:00:00Z',
      }],
    })
    legalApi.cancelDeletion.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<LegalPrivacySettingsCard enabled user={{ project_role: 'project_viewer' }} />)

    await user.click(await screen.findByRole('button', { name: '申請を取り消す' }))
    await waitFor(() => expect(legalApi.cancelDeletion).toHaveBeenCalledWith(
      'delete-1',
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^cancel-delete:/) }),
    ))
  })

  it('shows ready exports and downloads them through the authenticated client', async () => {
    ready({
      accepted: true,
      exports: [{
        job_id: 'export-1',
        scope: 'account',
        status: 'ready',
        download_available: true,
        expires_at: '2026-07-26T00:00:00Z',
      }],
    })
    legalApi.downloadDataExport.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'insight-studio-data.json',
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<LegalPrivacySettingsCard enabled user={{ project_role: 'project_viewer' }} />)

    await user.click(await screen.findByRole('button', { name: '標準形式で受け取る' }))

    await waitFor(() => expect(legalApi.downloadDataExport).toHaveBeenCalledWith(
      'export-1',
      'json',
    ))
    expect(createObjectURL).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
  })

  it('uses a safe retry state when legal metadata cannot be loaded', async () => {
    legalApi.getDocuments.mockRejectedValue(new Error('secret provider response'))
    render(<LegalPrivacySettingsCard enabled user={{ workspace_role: 'workspace_owner' }} />)
    expect(await screen.findByText('規約とデータ管理の状態を確認できませんでした。')).toBeInTheDocument()
    expect(screen.queryByText(/secret provider response/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度確認する' })).toBeInTheDocument()
  })
})
