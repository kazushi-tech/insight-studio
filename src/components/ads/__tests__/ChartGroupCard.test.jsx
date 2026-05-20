import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChartGroupCard from '../ChartGroupCard'

vi.mock('chart.js/auto', () => ({
  default: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

describe('ChartGroupCard', () => {
  it('shows coverage and warning metadata in the card header', () => {
    render(
      <ChartGroupCard
        group={{
          title: '検索クエリ — 上位2件 / 最大20件',
          chartType: 'bar_horizontal',
          labels: ['alpha', 'beta'],
          datasets: [{ label: '検索回数', data: [10, 5] }],
          coverageLabel: '上位2件 / 最大20件',
          warnings: ['low_sample'],
          defaultCollapsed: true,
        }}
      />,
    )

    expect(screen.getByText('検索クエリ — 検索回数上位2語')).toBeInTheDocument()
    expect(screen.getByText('検索回数上位2語を表示')).toBeInTheDocument()
    expect(screen.getByText('実数: 上位2件 / 最大20件')).toBeInTheDocument()
    expect(screen.getByText('低サンプル')).toBeInTheDocument()
    expect(screen.getByTitle('グラフを開く')).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not treat all-null series as renderable chart data', () => {
    render(
      <ChartGroupCard
        group={{
          title: '空グラフ',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02'],
          datasets: [{ label: '値', data: [null, null] }],
        }}
      />,
    )

    expect(screen.getByText('このグラフグループには描画できるデータ系列がありません。')).toBeInTheDocument()
  })
})
