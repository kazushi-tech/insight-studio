import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InsightSummaryHero from '../InsightSummaryHero'

describe('InsightSummaryHero', () => {
  it('returns null when meta is missing', () => {
    const { container } = render(<InsightSummaryHero meta={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when meta is undefined', () => {
    const { container } = render(<InsightSummaryHero />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when all three arrays are empty', () => {
    const { container } = render(
      <InsightSummaryHero
        meta={{ tldr: [], key_metrics: [], recommended_charts: [] }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null when all fields are non-array (defensive)', () => {
    const { container } = render(
      <InsightSummaryHero meta={{ tldr: 'x', key_metrics: 'y', recommended_charts: 'z' }} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders TL;DR bullets when tldr is provided', () => {
    render(
      <InsightSummaryHero
        meta={{
          tldr: ['CTR上昇', 'CPA悪化'],
          key_metrics: [],
          recommended_charts: [],
        }}
      />,
    )
    expect(screen.getByTestId('insight-summary-hero')).toBeInTheDocument()
    expect(screen.getByText('CTR上昇')).toBeInTheDocument()
    expect(screen.getByText('CPA悪化')).toBeInTheDocument()
    expect(screen.getByText('考察サマリー')).toBeInTheDocument()
  })

  it('renders KPI pills with up/down/flat delta icons', () => {
    render(
      <InsightSummaryHero
        meta={{
          tldr: [],
          key_metrics: [
            { label: 'CTR', value: '3.5%', delta: 'up' },
            { label: 'CPA', value: '¥2,800', delta: 'down' },
            { label: 'CVR', value: '1.2%', delta: 'flat' },
            { label: 'IMP', value: '10,000' },
          ],
          recommended_charts: [],
        }}
      />,
    )
    expect(screen.getByText('CTR')).toBeInTheDocument()
    expect(screen.getByText('3.5%')).toBeInTheDocument()
    expect(screen.getByText('CPA')).toBeInTheDocument()
    expect(screen.getByText('¥2,800')).toBeInTheDocument()
    expect(screen.getByText('CVR')).toBeInTheDocument()
    expect(screen.getByText('1.2%')).toBeInTheDocument()
    expect(screen.getByText('IMP')).toBeInTheDocument()
    expect(screen.getByText('10,000')).toBeInTheDocument()

    expect(screen.getByTestId('metric-delta-up')).toBeInTheDocument()
    expect(screen.getByTestId('metric-delta-down')).toBeInTheDocument()
    expect(screen.getByTestId('metric-delta-flat')).toBeInTheDocument()
    // No delta for IMP — only 3 icons total
    expect(screen.getAllByText('trending_up')).toHaveLength(1)
    expect(screen.getAllByText('trending_down')).toHaveLength(1)
    expect(screen.getAllByText('trending_flat')).toHaveLength(1)
  })

  it('renders recommended chart chips', () => {
    render(
      <InsightSummaryHero
        meta={{
          tldr: [],
          key_metrics: [],
          recommended_charts: ['CVR推移', 'CPA推移'],
        }}
      />,
    )
    expect(screen.getByTestId('insight-summary-chart-chips')).toBeInTheDocument()
    expect(screen.getByText('推奨グラフ')).toBeInTheDocument()
    expect(screen.getByText('CVR推移')).toBeInTheDocument()
    expect(screen.getByText('CPA推移')).toBeInTheDocument()
  })

  it('does not render the recommended chart section when empty', () => {
    render(
      <InsightSummaryHero
        meta={{
          tldr: ['foo'],
          key_metrics: [],
          recommended_charts: [],
        }}
      />,
    )
    expect(screen.queryByTestId('insight-summary-chart-chips')).not.toBeInTheDocument()
    expect(screen.queryByText('推奨グラフ')).not.toBeInTheDocument()
  })

  it('fires onChartChipClick with the chart title when a chip is clicked', () => {
    const onChartChipClick = vi.fn()
    render(
      <InsightSummaryHero
        meta={{
          tldr: [],
          key_metrics: [],
          recommended_charts: ['CVR推移', 'CPA推移'],
        }}
        onChartChipClick={onChartChipClick}
      />,
    )
    fireEvent.click(screen.getByText('CVR推移'))
    expect(onChartChipClick).toHaveBeenCalledWith('CVR推移')
    fireEvent.click(screen.getByText('CPA推移'))
    expect(onChartChipClick).toHaveBeenCalledWith('CPA推移')
    expect(onChartChipClick).toHaveBeenCalledTimes(2)
  })

  it('does not crash when onChartChipClick is undefined and a chip is clicked', () => {
    render(
      <InsightSummaryHero
        meta={{
          tldr: [],
          key_metrics: [],
          recommended_charts: ['CVR推移'],
        }}
      />,
    )
    expect(() => fireEvent.click(screen.getByText('CVR推移'))).not.toThrow()
  })
})
