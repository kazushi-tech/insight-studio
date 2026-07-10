import { describe, expect, it } from 'vitest'
import { buildCustomerSimpleReport } from '../customerReport'

describe('buildCustomerSimpleReport', () => {
  it('recognizes legacy chart titles even when queryType was missing', () => {
    const report = buildCustomerSimpleReport(
      [
        {
          title: 'PV分析 — 日別推移',
          chartType: 'line',
          labels: ['2026-07-01', '2026-07-02'],
          datasets: [{ label: 'PV数', data: [100, 120] }],
        },
        {
          title: '流入分析 — セッション数上位2チャネル',
          chartType: 'bar_horizontal',
          labels: ['organic', 'direct'],
          datasets: [{ label: 'セッション', data: [80, 40] }],
        },
        {
          title: 'CV分析 — イベント別日別推移',
          chartType: 'line',
          labels: ['2026-07-01', '2026-07-02'],
          datasets: [{ label: '問い合わせ', data: [2, 3] }],
        },
      ],
      [{ query_type: 'cv', status: 'success' }],
      { periodLabel: '最新期間' },
    )

    expect(report.summary.body).toContain('成果は 5 件確認できます')
    expect(report.notices.some((notice) => notice.key === 'cv_missing')).toBe(false)
  })

  it('uses the PV dataset and combines multiple outcome event series', () => {
    const report = buildCustomerSimpleReport(
      [
        {
          queryType: 'pv',
          title: 'PV分析 — 日別推移',
          labels: ['2026-07-01', '2026-07-02'],
          datasets: [
            { label: 'ユーザー数', data: [10, 20] },
            { label: 'セッション数', data: [30, 45] },
            { label: 'PV数', data: [100, 150] },
          ],
        },
        {
          queryType: 'cv',
          title: 'CV分析 — イベント別日別推移',
          labels: ['2026-07-01', '2026-07-02'],
          datasets: [
            { label: '問い合わせ', data: [2, 3] },
            { label: 'purchase', data: [1, 2] },
          ],
        },
      ],
      [{ query_type: 'cv', status: 'success' }],
    )

    expect(report.summary.body).toContain('見られた回数は +50.0%')
    expect(report.summary.body).toContain('成果は 8 件確認できます')
  })

  it('only warns about sudden changes when a Z-score crosses the threshold', () => {
    const baseGroups = [
      {
        queryType: 'anomaly',
        title: '異常検知 — Z-score',
        labels: ['2026-07-01', '2026-07-02'],
        datasets: [{ label: 'PV Z-score', data: [0.4, 1.8] }],
      },
    ]

    const normalReport = buildCustomerSimpleReport(baseGroups)
    expect(normalReport.summary.body).toContain('急な変化は、今の表示範囲では強く出ていません')

    const changedReport = buildCustomerSimpleReport([
      {
        ...baseGroups[0],
        datasets: [{ label: 'PV Z-score', data: [0.4, 2.3] }],
      },
    ])
    expect(changedReport.summary.body).toContain('急に変わった日がある可能性があります')
  })
})
