import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ProjectMembersDialog from '../ProjectMembersDialog'
import { platformApi } from '../../../api/platform'

vi.mock('../../../api/platform', () => ({
  platformApi: {
    listProjectMembers: vi.fn(),
    createProjectMember: vi.fn(),
    deleteProjectMember: vi.fn(),
  },
}))

describe('ProjectMembersDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platformApi.listProjectMembers.mockResolvedValue({ members: [] })
    platformApi.createProjectMember.mockResolvedValue({
      invitation: { status: 'pending', role: 'project_viewer', email_hash: 'hash-only' },
    })
  })

  it('invites by email using the canonical role and idempotency contract', async () => {
    const user = userEvent.setup()
    render(<ProjectMembersDialog project={{ id: 'p-1', name: '自社サイト' }} onClose={vi.fn()} />)
    await screen.findByText('参加済みメンバーはまだいません。')
    await user.type(screen.getByRole('textbox', { name: 'メールアドレス' }), 'Member@Example.com')
    await user.click(screen.getByRole('button', { name: '招待を送信' }))

    await waitFor(() => expect(platformApi.createProjectMember).toHaveBeenCalledWith(
      'p-1',
      { email: 'member@example.com', role: 'project_viewer' },
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^project-invite:/) }),
    ))
    expect(screen.getByText('招待メールを送信しました。参加が完了すると一覧へ反映されます。')).toBeInTheDocument()
    expect(screen.queryByText('member@example.com')).not.toBeInTheDocument()
  })
})
