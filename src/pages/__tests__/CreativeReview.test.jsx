import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server.js'
import { TestProviders } from '../../test/mocks/contexts.js'
import CreativeReview from '../CreativeReview.jsx'

vi.mock('../../components/MarkdownRenderer', () => ({
  default: ({ content }) => <div data-testid="markdown-renderer">{content}</div>,
}))

vi.mock('../../components/PerformanceRadar', () => ({
  AXIS_GROUPS_BY_TYPE: {
    banner_review: {
      visual: { label: 'Visual', ids: ['visual_impact'] },
    },
    ad_lp_review: {
      fit: { label: 'Fit', ids: ['ad_to_lp_message_match'] },
    },
  },
  default: () => <div data-testid="performance-radar" />,
}))

function setGeminiKey() {
  sessionStorage.setItem('is_gemini_key', 'AIza-test-key-for-creative-review')
}

function renderCreativeReview() {
  return render(<CreativeReview />, { wrapper: TestProviders })
}

beforeEach(() => {
  setGeminiKey()
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('CreativeReview', () => {
  it('uploads a banner and safely complements sparse review output', async () => {
    server.use(
      http.post('/api/ml/assets', () =>
        HttpResponse.json({
          asset_id: 'asset-creative-001',
          file_name: 'banner.jpg',
          mime_type: 'image/jpeg',
          size_bytes: 4096,
          width: 300,
          height: 250,
        }),
      ),
      http.post('/api/ml/reviews/banner', () =>
        HttpResponse.json({
          run_id: 'review-run-001',
          review: {
            review_type: 'banner_review',
            summary: 'Sparse but valid response',
          },
        }),
      ),
    )

    renderCreativeReview()

    const file = new File(['sample'], 'banner.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('バナー画像ファイル'), {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getAllByText('banner.jpg').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText('レビュー実行前チェック')).toBeInTheDocument()
    expect(screen.getByText('不足項目は評価保留で表示')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'バナーレビューを実行' }))

    await screen.findByText('レビュー結果')
    expect(screen.getByText('評価保留・運用者確認を含みます')).toBeInTheDocument()
    expect(screen.getByText('良い点・維持すべき点')).toBeInTheDocument()
    expect(screen.getByText('改善提案')).toBeInTheDocument()
    expect(screen.getByText('エビデンス')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the upload target keyboard accessible', () => {
    renderCreativeReview()

    expect(screen.getByRole('heading', { level: 1, name: '広告画像を確認する' })).toBeInTheDocument()
    const uploadButton = screen.getByRole('button', { name: 'バナー画像をアップロード' })
    expect(uploadButton).toHaveAttribute('tabindex', '0')
    expect(screen.queryByText('レポートをダウンロード')).not.toBeInTheDocument()
    expect(screen.queryByText('レポートを保存')).not.toBeInTheDocument()
  })

  it('shows fictional demo creative entry points in the empty state', () => {
    renderCreativeReview()

    expect(screen.getByText('自分の画像がない場合は、架空デモ素材で試す')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /架空インテリアEC/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /架空スキンケアEC/ })).toBeInTheDocument()
    expect(screen.getByText('架空の検証用クリエイティブです。実在ブランド・実在商品ではありません。')).toBeInTheDocument()
  })

  it('guides users without an analysis key to settings', () => {
    sessionStorage.removeItem('is_gemini_key')

    renderCreativeReview()

    expect(screen.getByText('分析用APIキーを設定してください')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'APIキーを設定する' })).toHaveAttribute('href', '/settings')
  })

})
