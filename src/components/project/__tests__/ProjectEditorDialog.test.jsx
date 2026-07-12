import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ProjectEditorDialog from '../ProjectEditorDialog'
import { platformApi } from '../../../api/platform'

vi.mock('../../../api/platform', () => ({
  platformApi: {
    createProject: vi.fn(),
    updateProject: vi.fn(),
    putDataSource: vi.fn(),
    testDataSource: vi.fn(),
  },
}))

describe('ProjectEditorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformApi.createProject.mockResolvedValue({
      project: { id: 'project-1', name: '自社サイト', version: 1 },
    })
    platformApi.putDataSource.mockResolvedValue({ data_source: { configured: true } })
    platformApi.testDataSource.mockResolvedValue({ connected: true, status: 'active' })
  })

  it('creates a project with idempotency and can defer its connection', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<ProjectEditorDialog onSaved={onSaved} onClose={onClose} />)

    await user.type(screen.getByRole('textbox', { name: '案件名' }), '自社サイト')
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    await waitFor(() => expect(platformApi.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: '自社サイト', is_demo: false }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^project-create:/) }),
    ))
    await user.click(screen.getByRole('button', { name: '後で接続する' }))
    await user.click(screen.getByRole('button', { name: '完了' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('stores conversion event configuration and verifies the connection', async () => {
    const user = userEvent.setup()
    render(<ProjectEditorDialog onSaved={vi.fn()} onClose={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: '案件名' }), 'Site')
    await user.click(screen.getByRole('button', { name: '保存して次へ' }))
    await user.type(await screen.findByRole('textbox', { name: 'Google Cloudのプロジェクト名' }), 'cloud-a')
    await user.type(screen.getByRole('textbox', { name: 'アクセス対象のデータ保存先' }), 'analytics_123')
    await user.type(screen.getByRole('textbox', { name: '成果として数えるイベント（任意）' }), 'generate_lead, purchase')
    await user.click(screen.getByRole('button', { name: '接続情報を保存' }))
    await waitFor(() => expect(platformApi.putDataSource).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        source_type: 'ga4_bigquery',
        safe_config: { conversion_events: ['generate_lead', 'purchase'] },
      }),
    ))
    await user.click(screen.getByRole('button', { name: '接続を確認' }))
    expect(await screen.findByText('接続を確認できました')).toBeInTheDocument()
  })
})
