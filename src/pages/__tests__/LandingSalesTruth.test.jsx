import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import LandingPage from '../landing/LandingPage'
import LpCompare from '../landing/LpCompare'
import LpCreative from '../landing/LpCreative'
import LpDiscovery from '../landing/LpDiscovery'
import LpPerformance from '../landing/LpPerformance'
import LpPricing from '../landing/LpPricing'
import LpFooter from '../landing/components/LpFooter'

beforeAll(() => {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.IntersectionObserver = IntersectionObserverStub
})

function renderPage(Page) {
  return render(
    <MemoryRouter>
      {createElement(Page)}
    </MemoryRouter>,
  )
}

describe('landing sales claims', () => {
  it('positions the product for beginners and uses the selected human hero image', () => {
    renderPage(LandingPage)

    expect(screen.getByRole('heading', { level: 1, name: /サイトの数字を、\s*次の行動へ。/ })).toBeInTheDocument()
    expect(screen.getByText(/基本分析はAIキーなし/)).toBeInTheDocument()
    expect(screen.getByAltText('Webサイトの数字を一緒に確認する担当者')).toHaveAttribute(
      'src',
      '/imagegen/beginner-analytics-collaboration.webp',
    )
    expect(screen.getByRole('heading', { name: '開いたら、見る順番が分かります。' })).toBeInTheDocument()
    expect(screen.getByAltText('データを整理して次の行動へ進む流れ')).toHaveAttribute(
      'src',
      '/imagegen/data-to-action-paper-collage.webp',
    )
    expect(screen.queryByText('CHALLENGES')).not.toBeInTheDocument()
    expect(screen.queryByText('WHY INSIGHT STUDIO')).not.toBeInTheDocument()
    screen.getAllByRole('link', { name: /画面サンプルを見る/ }).forEach((link) => {
      expect(link).toHaveAttribute('href', '/lp#product-preview')
    })
  })

  it('describes pricing as early access without inventing a fixed public contract', () => {
    renderPage(LpPricing)

    expect(screen.getAllByText(/現在は先行導入として/)).not.toHaveLength(0)
    expect(screen.getByText('先行導入')).toBeInTheDocument()
    expect(screen.getByText('個別見積もり')).toBeInTheDocument()
    expect(screen.queryByText(/14日間無料|返金保証|いつでも解約/)).not.toBeInTheDocument()
    expect(screen.getByText('無料')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '契約を急がず、条件を順番に確認します。' })).toBeInTheDocument()
  })

  it('uses live company and sales links instead of unfinished footer items', () => {
    renderPage(LpFooter)

    expect(screen.queryByText('準備中')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '導入相談' })).toHaveAttribute('href', 'https://www.petabit.co.jp/contact/')
    expect(screen.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', 'https://www.petabit.co.jp/privacy/')
    expect(screen.getByRole('link', { name: '会社概要' })).toHaveAttribute('href', 'https://www.petabit.co.jp/about/')
  })

  it.each([
    [LpPerformance, /基本レポートと根拠整理にはAIキーが要りません/, /Google側の設定が必要/],
    [LpCompare, /公開LPを並べ/, /成果を保証するものではありません/],
    [LpCreative, /次に試す仮説を整理/, /画像分析にはAIキーが必要です/],
    [LpDiscovery, /最終判断は人が根拠を見て行います/, /リアルタイム監視機能ではありません/],
  ])('keeps each feature page inside its real operating boundary', (Page, description, boundary) => {
    renderPage(Page)

    expect(screen.getByText(description)).toBeInTheDocument()
    expect(screen.getByText(boundary)).toBeInTheDocument()
  })
})
