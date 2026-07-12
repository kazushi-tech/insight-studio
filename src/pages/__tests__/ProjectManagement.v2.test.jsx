import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ProjectManagement from '../ProjectManagement'
import { platformApi } from '../../api/platform'

vi.mock('../../api/platform', () => ({
  platformApi: {
    listProjects: vi.fn(),
    getDataSource: vi.fn(),
    archiveProject: vi.fn(),
  },
}))

vi.mock('../../contexts/RbacContext', () => ({
  useRbac: () => ({ canManageProjects: true }),
}))

const PROJECT = {
  id: 'project-1',
  name: '自社サイト',
  description: '成果を確認するサイト',
  status: 'active',
  version: 4,
}

describe('ProjectManagement v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformApi.listProjects.mockResolvedValue({ projects: [PROJECT] })
    platformApi.getDataSource.mockResolvedValue({
      data_source: { configured: true, status: 'active', dataset_id: undefined },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('shows tenant projects and a redacted connection status', async () => {
    render(<ProjectManagement />)
    expect(await screen.findByRole('heading', { name: '自社サイト' })).toBeInTheDocument()
    expect(screen.getByText('接続済み')).toBeInTheDocument()
    expect(screen.queryByText(/dataset|analytics_|project-1/i)).not.toBeInTheDocument()
  })

  it('archives with the optimistic-lock version and reloads', async () => {
    platformApi.archiveProject.mockResolvedValue({ project: { ...PROJECT, status: 'archived', version: 5 } })
    const user = userEvent.setup()
    render(<ProjectManagement />)
    await user.click(await screen.findByRole('button', { name: 'アーカイブ' }))
    await waitFor(() => expect(platformApi.archiveProject).toHaveBeenCalledWith('project-1', 4))
    expect(platformApi.listProjects).toHaveBeenCalledTimes(2)
  })

  it('uses a safe retry state without rendering backend details', async () => {
    platformApi.listProjects.mockRejectedValue(new Error('postgres://secret-host'))
    render(<ProjectManagement />)
    expect(await screen.findByText('案件一覧を確認できませんでした。少し待ってもう一度お試しください。')).toBeInTheDocument()
    expect(screen.queryByText(/postgres|secret-host/)).not.toBeInTheDocument()
  })
})
