import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InsightChartPanel from '../InsightChartPanel'

// Light mock for ChartGroupCard — exercising the real component would pull in
// chart.js and DOM canvas setup unrelated to the panel behavior.
vi.mock('../../../ads/ChartGroupCard', () => ({
  default: vi.fn(({ group }) => (
    <div data-testid="chart-group-card">{group?.title ?? ''}</div>
  )),
}))

const makeGroup = (title, extras = {}) => ({
  title,
  labels: ['a', 'b'],
  datasets: [{ label: 'series', data: [1, 2] }],
  chartType: 'line',
  ...extras,
})

describe('InsightChartPanel', () => {
  it('renders nothing when groups is empty', () => {
    const { container } = render(<InsightChartPanel groups={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when groups is undefined', () => {
    const { container } = render(<InsightChartPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the header with group count in Japanese', () => {
    render(<InsightChartPanel groups={[makeGroup('A'), makeGroup('B')]} />)
    expect(screen.getByText('関連データグラフを展開 (2)')).toBeInTheDocument()
  })

  it('opens by default when groups.length <= 2 and renders one card per group', () => {
    render(<InsightChartPanel groups={[makeGroup('A'), makeGroup('B')]} />)
    expect(screen.getByTestId('insight-chart-panel-body')).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-group-card')).toHaveLength(2)
  })

  it('is collapsed by default when groups.length > 2', () => {
    render(<InsightChartPanel groups={[makeGroup('A'), makeGroup('B'), makeGroup('C')]} />)
    expect(screen.queryByTestId('insight-chart-panel-body')).not.toBeInTheDocument()
  })

  it('toggles expanded state when the header is clicked', () => {
    render(<InsightChartPanel groups={[makeGroup('A'), makeGroup('B'), makeGroup('C')]} />)
    // Collapsed initially (3 > 2)
    expect(screen.queryByTestId('insight-chart-panel-body')).not.toBeInTheDocument()

    // Click header to expand
    fireEvent.click(screen.getByTestId('insight-chart-panel-header'))
    expect(screen.getByTestId('insight-chart-panel-body')).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-group-card')).toHaveLength(3)

    // Click again to collapse
    fireEvent.click(screen.getByTestId('insight-chart-panel-header'))
    expect(screen.queryByTestId('insight-chart-panel-body')).not.toBeInTheDocument()
  })
})
