import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalysisHub from '../AnalysisHub'

const hoisted = vi.hoisted(() => ({
  hasAnalysisKey: false,
  isAdsAuthenticated: true,
  setupReady: true,
  role: 'admin',
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasAnalysisKey: hoisted.hasAnalysisKey,
    isAdsAuthenticated: hoisted.isAdsAuthenticated,
    user: { role: hoisted.role },
  }),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => ({
    isSetupComplete: hoisted.setupReady,
    isCaseAuthenticated: hoisted.setupReady,
    setupState: hoisted.setupReady ? { datasetId: 'analytics_311324674' } : null,
    currentCase: { dataset_id: 'analytics_311324674' },
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analysis']}>
      <AnalysisHub />
    </MemoryRouter>,
  )
}

describe('AnalysisHub', () => {
  beforeEach(() => {
    hoisted.hasAnalysisKey = false
    hoisted.isAdsAuthenticated = true
    hoisted.setupReady = true
    hoisted.role = 'admin'
  })

  it('shows every analysis option even when an API key is not configured', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'やりたいことから選べます' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数字についてAIに相談する（AI考察）' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '自社と競合のページを比べる（競合LP比較）' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '似ている競合サイトを探す（競合発見）' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'バナー画像の改善点を見る（バナーレビュー）' })).toBeInTheDocument()
    expect(screen.queryByText(/専門用語/)).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: /AI考察を開く/ })).toHaveAttribute('href', '/insights/ai')
    expect(screen.getByRole('link', { name: /ページ比較を開く/ })).toHaveAttribute('href', '/compare')
    expect(screen.getByRole('link', { name: /競合探しを開く/ })).toHaveAttribute('href', '/discovery')
    expect(screen.getByRole('link', { name: /バナー確認を開く/ })).toHaveAttribute('href', '/creative-review')
    expect(screen.getAllByRole('link', { name: /追加分析を有効にする/ }).length).toBeGreaterThanOrEqual(4)
  })

  it('shows the configured status without hiding any tool', () => {
    hoisted.hasAnalysisKey = true
    renderPage()

    expect(screen.getByText('追加分析の準備ができています')).toBeInTheDocument()
    expect(screen.getAllByText('APIキー設定済み')).toHaveLength(3)
    expect(screen.getByRole('link', { name: '追加分析の設定を確認' })).toHaveAttribute('href', '/settings')
    expect(screen.getAllByRole('article')).toHaveLength(4)
  })

  it('sends site-report actions to setup when the site analysis is not ready', () => {
    hoisted.isAdsAuthenticated = false
    hoisted.setupReady = false
    renderPage()

    expect(screen.getByText('サイト分析の準備が必要')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /サイト分析を準備/ })).toHaveAttribute('href', '/ads/wizard')
    expect(screen.getByRole('link', { name: '分析を準備' })).toHaveAttribute('href', '/ads/wizard')
    expect(screen.queryByRole('link', { name: 'グラフを見る' })).not.toBeInTheDocument()
  })

  it('keeps advanced options visible but operator-controlled for case users', () => {
    hoisted.role = 'case_user'
    hoisted.hasAnalysisKey = false
    renderPage()

    expect(screen.getByText('追加分析は導入担当者が行います')).toBeInTheDocument()
    expect(screen.getAllByText('導入担当者が利用')).toHaveLength(3)
    expect(screen.getAllByText('先行導入では担当者が実行')).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /ページ比較を開く/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '自社レポートを見る' })).toHaveAttribute('href', '/ads/report')
  })
})
