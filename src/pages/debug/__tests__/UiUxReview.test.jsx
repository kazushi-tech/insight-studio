import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UiUxReview from '../UiUxReview'

describe('UiUxReview', () => {
  it('renders five review tabs and GPT Image2 mockups', async () => {
    render(<UiUxReview />)

    expect(screen.getByText('Insight Studio UI/UX 再設計レビュー')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ダッシュボード' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '競合LP分析' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '競合発見' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '広告グラフ / AI考察' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'バナーレビュー' })).toBeInTheDocument()
    expect(screen.getByAltText('ダッシュボード 01 Overview GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/dashboard-01-overview.png',
    )
    expect(screen.getByAltText('ダッシュボード 02 Detail GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/dashboard-02-detail.png',
    )

    await userEvent.click(screen.getByRole('tab', { name: '広告グラフ / AI考察' }))
    expect(screen.getByAltText('広告グラフ / AI考察 01 KPI GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/ads-01-kpi.png',
    )
    expect(screen.getByAltText('広告グラフ / AI考察 05 AI GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/ads-05-ai-question.png',
    )
    expect(screen.getByTestId('ads-ai-review-preview')).toBeInTheDocument()
    expect(screen.getByText('Python集計グラフを見ながらAIに聞く')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'バナーレビュー' }))
    expect(screen.getByAltText('バナーレビュー 01 Overview GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/banner-01-overview.png',
    )
    expect(screen.getByAltText('バナーレビュー 02 Detail GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/banner-02-detail.png',
    )
    expect(screen.getByTestId('banner-review-preview')).toBeInTheDocument()
  })

  it('splits Compare and Discovery mockups into sparse scroll sections', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: '競合LP分析' }))
    expect(screen.getByAltText('競合LP分析 01 Input GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/compare-01-input.png',
    )
    expect(screen.getByAltText('競合LP分析 04 Actions GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/compare-04-actions.png',
    )

    await userEvent.click(screen.getByRole('tab', { name: '競合発見' }))
    expect(screen.getByAltText('競合発見 01 Found GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/discovery-01-found.png',
    )
    expect(screen.getByAltText('競合発見 04 Report GPT Image2 UI direction mockup')).toHaveAttribute(
      'src',
      '/ux-mockups/discovery-04-report.png',
    )
  })

  it('keeps Discovery preview simple and labels out-of-scope as excluded', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: '競合発見' }))
    expect(screen.getByTestId('discovery-review-preview')).toBeInTheDocument()
    expect(screen.getByText('ツール系URLのため除外')).toBeInTheDocument()
    expect(screen.getByText('自社LPと直接競合だけをグラフ化し、対象外URLは主比較に混ぜません。')).toBeInTheDocument()
  })

  it('lets report chat panels collapse with one click', async () => {
    render(<UiUxReview />)

    await userEvent.click(screen.getByRole('tab', { name: '競合LP分析' }))
    expect(screen.getByText('最初に直す場所は？')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'AIチャットを閉じる' }))
    expect(screen.queryByText('最初に直す場所は？')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AIチャットを開く' })).toBeInTheDocument()
  })
})
