import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectManagement from '../ProjectManagement'

const listProjects = vi.fn()

vi.mock('../../api/platform', () => ({
  platformApi: {
    listProjects: (...args) => listProjects(...args),
    getDataSource: vi.fn(),
    archiveProject: vi.fn(),
  },
}))

vi.mock('../../contexts/RbacContext', () => ({
  useRbac: () => ({ canManageProjects: true }),
}))

describe('ProjectManagement heading semantics', () => {
  beforeEach(() => {
    listProjects.mockReset()
    listProjects.mockResolvedValue({ projects: [] })
  })

  it('uses the existing page title as the only h1', async () => {
    render(<ProjectManagement />)

    expect(await screen.findByRole('heading', { level: 1, name: '分析するサイト' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
