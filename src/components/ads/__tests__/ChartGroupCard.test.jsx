import { fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: /検索クエリ.*を開く/ })).toBeInTheDocument()
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
    expect(screen.getByText('ランディングページ比較（直帰率）')).toBeInTheDocument()
    expect(screen.getByText('比較有用性: 低い')).toBeInTheDocument()
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

    expect(screen.getByText('この期間の検索イベントは3件です')).toBeInTheDocument()
    expect(screen.getByText('発生日の点表示')).toBeInTheDocument()
    expect(screen.getByText('raw count 表示')).toBeInTheDocument()
  })

  it('marks crowded line charts as small multiple trends when collapsed', () => {
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

    expect(screen.getByText('系列別推移')).toBeInTheDocument()
    expect(screen.getByTitle('グラフを開く')).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders a doughnut chart with always-visible color legend', () => {
    render(
      <ChartGroupCard
        group={{
          title: '流入分析 — チャネル別セッション構成',
          chartType: 'doughnut',
          labels: ['organic', 'direct', 'referral'],
          datasets: [{ label: 'セッション構成比', data: [979, 670, 10] }],
        }}
      />,
    )

    expect(screen.getByText('構成比')).toBeInTheDocument()
    expect(screen.getByText('項目とカラー')).toBeInTheDocument()
    expect(screen.getAllByText('organic').length).toBeGreaterThan(0)
    expect(screen.getAllByText('direct').length).toBeGreaterThan(0)
    expect(screen.getAllByText('referral').length).toBeGreaterThan(0)
  })

  it('puts multi-series line legends below the full-width chart', () => {
    render(
      <ChartGroupCard
        group={{
          title: '日別チャネル推移',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02', '2026-05-03'],
          datasets: [
            { label: 'PV', data: [100, 160, 120] },
            { label: 'セッション', data: [80, 120, 95] },
          ],
        }}
      />,
    )

    expect(screen.getByText('凡例 / 読みどころ')).toBeInTheDocument()
    expect(screen.getByText('比較する線')).toBeInTheDocument()
    expect(screen.getByText('最大日')).toBeInTheDocument()
    expect(screen.queryByText(/ピーク /)).not.toBeInTheDocument()
    expect(screen.getAllByTestId('trend-point')).toHaveLength(6)
    expect(screen.getByText('凡例クリックで系列を非表示')).toBeInTheDocument()

    const sessionLegend = screen.getByRole('button', { name: /セッション/ })
    fireEvent.click(sessionLegend)

    expect(within(sessionLegend).getByText('非表示中')).toBeInTheDocument()
  })

  it('switches three or more daily line series to small multiple trends instead of crowded trend lines', () => {
    render(
      <ChartGroupCard
        group={{
          title: '日別チャネル推移',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02', '2026-05-03'],
          datasets: [
            { label: 'one', data: [100, 160, 120] },
            { label: 'two', data: [80, 120, 95] },
            { label: 'three', data: [40, 42, 38] },
            { label: 'four', data: [20, 24, 21] },
            { label: 'five', data: [10, 12, 11] },
          ],
        }}
      />,
    )

    expect(screen.getByText('系列別推移')).toBeInTheDocument()
    expect(screen.getByText('3系列以上は重ねず、選択系列の大きな推移で形と値を読み分けます。')).toBeInTheDocument()
    expect(screen.getByText('系列フォーカス推移')).toBeInTheDocument()
    expect(screen.getAllByTestId('small-multiple-trend-row')).toHaveLength(5)
    expect(screen.getAllByTestId('focused-trend-point')).toHaveLength(3)
    fireEvent.mouseEnter(screen.getAllByTestId('focused-trend-point')[0])
    expect(screen.getAllByText('100').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('heatmap-data-cell')).not.toBeInTheDocument()
    expect(screen.queryByTestId('series-summary-bar-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trend-point')).not.toBeInTheDocument()
  })

  it('shows persistent hover details on ranking bar charts', () => {
    render(
      <ChartGroupCard
        group={{
          title: '検索クエリ — 検索回数上位3語',
          chartType: 'bar_horizontal',
          labels: ['alpha', 'beta', 'gamma'],
          datasets: [{ label: '検索回数', data: [100, 60, 20] }],
        }}
      />,
    )

    expect(screen.getByText('横棒比較')).toBeInTheDocument()
    expect(screen.getByText('1位 / 表示内シェア 55.6%')).toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByRole('listitem', { name: /2位 beta 60/ }))

    expect(screen.getByText('2位 / 表示内シェア 33.3%')).toBeInTheDocument()
  })

  it('does not add percentages or present them as composition share', () => {
    render(
      <ChartGroupCard
        group={{
          title: '入口ページ — すぐ帰った人の割合',
          chartType: 'bar_horizontal',
          labels: ['/a', '/b', '/c'],
          datasets: [{ label: '直帰率', data: [62, 48, 35], isPercent: true }],
        }}
      />,
    )

    expect(screen.getByText('平均')).toBeInTheDocument()
    expect(screen.getByText('割合は合計せず、値の高い順と平均を同じ画面で確認します。')).toBeInTheDocument()
    expect(screen.queryByText('トップ占有')).not.toBeInTheDocument()
    expect(screen.queryByText('表示内合計')).not.toBeInTheDocument()
  })

  it('routes only z-score anomaly charts to the anomaly card', () => {
    const { rerender } = render(
      <ChartGroupCard
        group={{
          title: '異常検知 — メトリクス推移',
          queryType: 'anomaly',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02', '2026-05-03'],
          datasets: [
            { label: 'ユーザー', data: [100, 110, 95] },
            { label: 'セッション', data: [120, 125, 108] },
            { label: 'PV', data: [180, 190, 170] },
          ],
        }}
      />,
    )

    expect(screen.queryByText('Z-score フォーカスチャート')).not.toBeInTheDocument()

    rerender(
      <ChartGroupCard
        group={{
          title: '異常検知 — Z-score',
          queryType: 'anomaly',
          chartType: 'line',
          labels: ['2026-05-01', '2026-05-02', '2026-05-03'],
          datasets: [{ label: 'Sessions Z', data: [0.2, 2.3, -0.5] }],
        }}
      />,
    )

    expect(screen.getByText('Z-score フォーカスチャート')).toBeInTheDocument()
    const focusablePoints = screen.getAllByTestId('anomaly-point').filter((point) => point.tabIndex === 0)
    expect(focusablePoints).toHaveLength(2)
  })
})
