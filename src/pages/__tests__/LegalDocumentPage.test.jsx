import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import LegalDocumentPage from '../LegalDocumentPage'
import { legalApi } from '../../api/legal'

vi.mock('../../api/legal', () => ({
  legalApi: { getDocuments: vi.fn() },
}))

function renderPage(document = 'terms') {
  return render(
    <MemoryRouter>
      <LegalDocumentPage document={document} />
    </MemoryRouter>,
  )
}

describe('LegalDocumentPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('links only to the approved source document without generating legal prose', async () => {
    legalApi.getDocuments.mockResolvedValue({
      documents: [{
        document_key: 'privacy',
        title: '承認済みプライバシーポリシー',
        version: 'v3',
        effective_at: '2026-07-12T00:00:00Z',
        public_url: 'https://legal.example.test/privacy-v3',
      }],
    })
    renderPage('privacy')

    expect(screen.getByRole('heading', { level: 1, name: 'プライバシーポリシー' })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: /承認済み文書を開く/ })
    expect(link).toHaveAttribute('href', 'https://legal.example.test/privacy-v3')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('v3')).toBeInTheDocument()
  })

  it('fails closed when the approved document is absent', async () => {
    legalApi.getDocuments.mockResolvedValue({ documents: [] })
    renderPage('security')
    expect(await screen.findByText('この文書は会社確認中です')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /承認済み文書を開く/ })).not.toBeInTheDocument()
  })

  it('does not leak provider errors when metadata loading fails', async () => {
    legalApi.getDocuments.mockRejectedValue(new Error('database host and secret'))
    renderPage('commercial-transactions')
    expect(await screen.findByText('承認済み文書はまだ公開されていません')).toBeInTheDocument()
    expect(screen.queryByText(/database host and secret/)).not.toBeInTheDocument()
  })
})
