import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChartGroupCard from '../ChartGroupCard'

vi.mock('chart.js/auto', () => ({
  default: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

describe('ChartGroupCard', () => {
  it('opens chart content by default and collapses from the card header', () => {
    render(
      <ChartGroupCard
        group={{
          title: 'LP分析 — 直帰率上位4LP',
          chartType: 'bar_horizontal',
          labels: ['/a', '/b', '/c', '/d'],
          datasets: [{ label: '直帰率 (%)', data: [100, 100, 100, 100] }],
        }}
      />,
    )

    const header = screen.getByTitle('グラフを閉じる')
    expect(header).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(header)

    expect(screen.getByTitle('グラフを開く')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/展開すると診断カードと詳細表を確認できます/)).toBeInTheDocument()
  })

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

  it('renders a diagnostic card instead of a flat bounce-rate bar chart', () => {
    render(
      <ChartGroupCard
        group={{
          title: 'LP分析 — 直帰率上位20LP',
          chartType: 'bar_horizontal',
          labels: ['/a', '/b', '/c'],
          datasets: [{ label: '直帰率 (%)', data: [100, 100, 100] }],
          coverageLabel: '上位3件 / 最大20件',
        }}
      />,
    )

    expect(screen.getAllByText('比較差なし').length).toBeGreaterThan(0)
    expect(screen.getByText('すべて同じ値のため、棒グラフ比較は表示しません')).toBeInTheDocument()
    expect(screen.getByText('平均ページ/セッション')).toBeInTheDocument()
  })

  it('renders a low-sample state instead of a search trend line chart', () => {
    render(
      <ChartGroupCard
        group={{
          title: '検索クエリ — 検索回数上位3語の日別推移',
          queryType: 'search',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02'],
          datasets: [
            { label: 'alpha', data: [1, 0] },
            { label: 'beta', data: [0, 2] },
          ],
          actualCount: 3,
          warnings: ['low_sample'],
        }}
      />,
    )

    expect(screen.getByText('検索回数が少ないため、日別トレンド化しません')).toBeInTheDocument()
    expect(screen.getByText('全期間まとめで確認')).toBeInTheDocument()
  })

  it('marks crowded line charts as focused when collapsed', () => {
    render(
      <ChartGroupCard
        group={{
          title: 'LP分析 — セッション数上位5LPの日別推移',
          chartType: 'line',
          labels: Array.from({ length: 14 }, (_, index) => `2026-05-${String(index + 1).padStart(2, '0')}`),
          datasets: Array.from({ length: 5 }, (_, index) => ({
            label: `https://example.com/landing-page-${index + 1}`,
            data: Array.from({ length: 14 }, (_, day) => day + index),
          })),
          defaultCollapsed: true,
        }}
      />,
    )

    expect(screen.getByText('主系列を強調')).toBeInTheDocument()
    expect(screen.getByTitle('グラフを開く')).toHaveAttribute('aria-expanded', 'false')
  })
})
