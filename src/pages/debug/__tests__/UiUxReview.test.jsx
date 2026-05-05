import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UiUxReview from '../UiUxReview'

describe('UiUxReview', () => {
  it('renders five review tabs and GPT Image2 mockups', async () => {
    render(<UiUxReview />)

    expect(screen.getByText('Insight Studio UI/UX 再設計レビュー')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Compare Report' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Discovery Report' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ads AI Report' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Banner Review' })).toBeInTheDocument()
    expect(screen.getByAltText('Dashboard 01 Overview GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/dashboard-01-overview.png',
    )
    expect(screen.getByAltText('Dashboard 02 Detail GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/dashboard-02-detail.png',
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Ads AI Report' }))
    expect(screen.getByAltText('Ads AI Report 01 KPI GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/ads-01-kpi.png',
    )
    expect(screen.getByAltText('Ads AI Report 05 AI GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/ads-05-ai-question.png',
    )
    expect(screen.getByTestId('ads-ai-review-preview')).toBeInTheDocument()
    expect(screen.getByText('Python集計グラフを見ながらAIに聞く')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Banner Review' }))
    expect(screen.getByAltText('Banner Review 01 Overview GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/banner-01-overview.png',
    )
    expect(screen.getByAltText('Banner Review 02 Detail GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/banner-02-detail.png',
    )
    expect(screen.getByTestId('banner-review-preview')).toBeInTheDocument()
  })

  it('splits Compare and Discovery mockups into sparse scroll sections', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: 'Compare Report' }))
    expect(screen.getByAltText('Compare Report 01 Input GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/compare-01-input.png',
    )
    expect(screen.getByAltText('Compare Report 04 Actions GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/compare-04-actions.png',
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Discovery Report' }))
    expect(screen.getByAltText('Discovery Report 01 Found GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/discovery-01-found.png',
    )
    expect(screen.getByAltText('Discovery Report 04 Report GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/discovery-04-report.png',
    )
  })

  it('keeps Discovery preview simple and labels out-of-scope as excluded', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: 'Discovery Report' }))
    expect(screen.getByTestId('discovery-review-preview')).toBeInTheDocument()
    expect(screen.getByText('ツール系URLのため除外')).toBeInTheDocument()
    expect(screen.getByText('自社LPと直接競合だけをグラフ化し、対象外URLは主比較に混ぜません。')).toBeInTheDocument()
  })

  it('lets report chat panels collapse with one click', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: 'Compare Report' }))
    expect(screen.getByText('最初に直す場所は？')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'AIチャットを閉じる' }))
    expect(screen.queryByText('最初に直す場所は？')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AIチャットを開く' })).toBeInTheDocument()
  })
})
