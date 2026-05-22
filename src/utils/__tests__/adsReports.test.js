import { describe, it, expect } from 'vitest'
import {
  buildAdsReportBundle,
  buildChartEvidencePack,
  getDisplayChartGroups,
  matchRelevantCharts,
  normalizeChartGroupShape,
  pickExecutionSummary,
  selectChartGroupsForPrompt,
} from '../adsReports'
import { analyzeChartReadability, shortenChartLabel } from '../chartReadability'

const makeGroup = (overrides = {}) => ({
  title: '',
  labels: [],
  datasets: [],
  chartType: 'line',
  ...overrides,
})

describe('matchRelevantCharts', () => {
  it('returns [] for empty aiContent', () => {
    expect(matchRelevantCharts('', [makeGroup({ title: 'CVR推移' })])).toEqual([])
    expect(matchRelevantCharts(null, [makeGroup({ title: 'CVR推移' })])).toEqual([])
    expect(matchRelevantCharts(undefined, [makeGroup({ title: 'CVR推移' })])).toEqual([])
  })

  it('returns [] for empty chartGroups', () => {
    expect(matchRelevantCharts('CVR推移が改善しました', [])).toEqual([])
    expect(matchRelevantCharts('CVR推移が改善しました', null)).toEqual([])
    expect(matchRelevantCharts('CVR推移が改善しました', undefined)).toEqual([])
  })

  it('matches by group title (exact)', () => {
    const group = makeGroup({ title: 'CVR推移' })
    const result = matchRelevantCharts('直近のCVR推移について分析しました。', [group])
    expect(result).toEqual([group])
  })

  it('matches by KPI label', () => {
    const group = makeGroup({
      title: 'メトリクスサマリー',
      kpis: [{ label: 'セッション数' }],
    })
    const unrelated = makeGroup({
      title: '無関係',
      kpis: [{ label: '別の指標' }],
    })
    const content = 'セッション数が前週比+10%で推移しています。'
    const result = matchRelevantCharts(content, [unrelated, group])
    expect(result).toEqual([group])
  })

  it('matches by dataset label', () => {
    const group = makeGroup({
      title: '謎のタイトル',
      datasets: [{ label: 'コンバージョン率', data: [1, 2] }],
    })
    const unrelated = makeGroup({
      title: '謎のタイトル2',
      datasets: [{ label: 'Other', data: [3, 4] }],
    })
    const result = matchRelevantCharts('コンバージョン率が前期比で改善しました。', [
      unrelated,
      group,
    ])
    expect(result).toEqual([group])
  })

  it('sorts by descending score and respects limit', () => {
    const titleOnly = makeGroup({ title: 'セッション数' })
    const titleAndKpis = makeGroup({
      title: 'CVR推移',
      kpis: [{ label: 'CVR推移' }],
      datasets: [{ label: 'CVR推移', data: [1] }],
    })
    const datasetOnly = makeGroup({
      title: 'その他',
      datasets: [{ label: 'PV', data: [1] }],
    })
    const notMatched = makeGroup({ title: '無関係' })
    const content = 'CVR推移、セッション数、PVのすべてに言及します。'

    const result = matchRelevantCharts(content, [notMatched, titleOnly, titleAndKpis, datasetOnly], {
      limit: 2,
    })
    expect(result).toHaveLength(2)
    // titleAndKpis has score 3 (title) + 1 (kpi) + 1 (dataset) = 5 — highest
    expect(result[0]).toBe(titleAndKpis)
    // titleOnly has score 3 (title), datasetOnly has score 1 (dataset) — titleOnly is second
    expect(result[1]).toBe(titleOnly)
  })

  it('handles full-width spaces and unified dashes', () => {
    const group = makeGroup({ title: 'CVR\u3000推移\u2014概要' })
    const content = 'cvr 推移-概要 が気になります。'
    const result = matchRelevantCharts(content, [group])
    expect(result).toEqual([group])
  })

  it('returns [] when no scores are positive', () => {
    const group = makeGroup({ title: 'まったく関係ない' })
    expect(matchRelevantCharts('別のテキストです', [group])).toEqual([])
  })

  it('respects default limit of 3', () => {
    const groups = Array.from({ length: 5 }, (_, i) =>
      makeGroup({ title: `指標${i}` }),
    )
    const content = groups.map((g) => g.title).join(' ')
    const result = matchRelevantCharts(content, groups)
    expect(result).toHaveLength(3)
  })

})

describe('chart group normalization', () => {
  it('pads short data with null and reports missing values', () => {
    const normalized = normalizeChartGroupShape(makeGroup({
      title: '検索クエリ — 上位3件 / 最大20件',
      labels: ['a', 'b', 'c'],
      datasets: [{ label: '検索回数', data: [10, 5] }],
    }))

    expect(normalized.datasets[0].data).toEqual([10, 5, null])
    expect(normalized.metadata.hasLabelDataMismatch).toBe(true)
    expect(normalized.metadata.missingDataPoints).toBe(1)
    expect(normalized.warnings).toContain('label_data_mismatch')
    expect(normalized.warnings).toContain('missing_values')
  })

  it('keeps overflow data visible with placeholder labels instead of dropping it', () => {
    const normalized = normalizeChartGroupShape(makeGroup({
      labels: ['a'],
      datasets: [{ label: 'sessions', data: [10, 20, 30] }],
    }))

    expect(normalized.labels).toEqual(['a', '未対応ラベル 2', '未対応ラベル 3'])
    expect(normalized.datasets[0].data).toEqual([10, 20, 30])
    expect(normalized.metadata.overflowDataPoints).toBe(2)
    expect(normalized.warnings).toContain('overflow_values')
  })

  it('does not merge all-period ranking charts with different labels', () => {
    const groups = [
      makeGroup({
        title: '検索クエリ — 上位2件 / 最大20件',
        chartType: 'bar_horizontal',
        labels: ['alpha', 'beta'],
        datasets: [{ label: '検索回数', data: [10, 5] }],
        _periodTag: '2026-04',
      }),
      makeGroup({
        title: '検索クエリ — 上位2件 / 最大20件',
        chartType: 'bar_horizontal',
        labels: ['gamma', 'delta'],
        datasets: [{ label: '検索回数', data: [8, 4] }],
        _periodTag: '2026-05',
      }),
    ]

    const displayGroups = getDisplayChartGroups(groups, 'all')

    expect(displayGroups).toHaveLength(2)
    expect(displayGroups[0].labels).toEqual(['alpha', 'beta'])
    expect(displayGroups[1].labels).toEqual(['gamma', 'delta'])
  })

  it('filters groups that only contain null values', () => {
    const displayGroups = getDisplayChartGroups([
      makeGroup({
        title: '空グラフ',
        labels: ['a', 'b'],
        datasets: [{ label: '値', data: [null, null] }],
      }),
    ])

    expect(displayGroups).toEqual([])
  })

  it('matches report results by period key instead of relying only on index', () => {
    const bundle = buildAdsReportBundle({
      setupState: {
        datasetId: 'analytics_123',
        periods: ['2026-04', '2026-05'],
      },
      results: [
        {
          period: '2026-05',
          report_md: '# May',
          chart_data: { groups: [makeGroup({ title: 'May graph', labels: ['m'], datasets: [{ label: 'v', data: [1] }] })] },
        },
        {
          period: '2026-04',
          report_md: '# Apr',
          chart_data: { groups: [makeGroup({ title: 'Apr graph', labels: ['a'], datasets: [{ label: 'v', data: [2] }] })] },
        },
      ],
    })

    expect(bundle.periodReports[0].periodTag).toBe('2026-04')
    expect(bundle.periodReports[0].reportMd).toBe('# Apr')
    expect(bundle.periodReports[0].chartGroups[0].title).toBe('Apr graph')
    expect(bundle.periodReports[1].reportMd).toBe('# May')
  })

  it('renames trend coverage into a concrete selection explanation', () => {
    const normalized = normalizeChartGroupShape(makeGroup({
      title: 'LP分析 — 日別推移（上位5件 / 最大5件）',
      chartType: 'line',
      labels: ['20260501'],
      datasets: [{ label: 'www.petabit.co.jp/', data: [52] }],
      coverageLabel: '上位5件 / 最大5件',
    }))

    expect(normalized.title).toBe('LP分析 — セッション数上位5LPの日別推移')
    expect(normalized.selectionLabel).toBe('セッション数上位5LPを表示')
  })

  it('renames ranking coverage into a concrete chart title and selection explanation', () => {
    const normalized = normalizeChartGroupShape(makeGroup({
      title: 'ユーザー属性 — 地域別（上位15件 / 最大15件）',
      chartType: 'bar_horizontal',
      labels: Array.from({ length: 15 }, (_, i) => `city-${i + 1}`),
      datasets: [{ label: 'セッション', data: Array.from({ length: 15 }, (_, i) => 15 - i) }],
      coverageLabel: '上位15件 / 最大15件',
    }))

    expect(normalized.title).toBe('ユーザー属性 — セッション数上位15地域')
    expect(normalized.selectionLabel).toBe('セッション数上位15地域を表示')
    expect(normalized.labels).toHaveLength(15)
  })

  it('renames old auction-pressure chart titles into operator-friendly wording', () => {
    const normalized = normalizeChartGroupShape(makeGroup({
      title: 'オークション圧 — 日別チャネル推移',
      chartType: 'line',
      labels: ['20260501'],
      datasets: [{ label: 'organic', data: [120] }],
    }))

    expect(normalized.title).toBe('流入の競合影響チェック（推定） — 日別チャネル推移')
  })

  it('classifies crowded line charts as focused lines', () => {
    const group = makeGroup({
      title: 'LP分析 — セッション数上位5LPの日別推移',
      chartType: 'line',
      labels: Array.from({ length: 14 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`),
      datasets: Array.from({ length: 5 }, (_, i) => ({
        label: `lp-${i + 1}`,
        data: Array.from({ length: 14 }, (_, day) => day + i),
      })),
    })

    const readability = analyzeChartReadability(group, 'line')

    expect(readability.hasTooManyLineSeries).toBe(true)
    expect(readability.hasTooManyXAxisLabels).toBe(true)
    expect(readability.recommendedDisplayMode).toBe('focused_line')
  })

  it('classifies flat bounce rankings as diagnostic charts', () => {
    const group = makeGroup({
      title: 'LP分析 — 直帰率上位20LP',
      chartType: 'bar_horizontal',
      labels: ['/a', '/b', '/c'],
      datasets: [{ label: '直帰率 (%)', data: [100, 100, 100] }],
    })

    const readability = analyzeChartReadability(group, 'bar_horizontal')

    expect(readability.isFlatSeries).toBe(true)
    expect(readability.recommendedDisplayMode).toBe('flat_diagnostic')
  })

  it('classifies low-sample search trends as table-first states', () => {
    const group = makeGroup({
      title: '検索クエリ — 検索回数上位3語の日別推移',
      queryType: 'search',
      chartType: 'line',
      labels: ['2026-05-01', '2026-05-02'],
      datasets: [{ label: 'alpha', data: [1, 2] }],
      actualCount: 3,
      warnings: ['low_sample'],
    })

    expect(analyzeChartReadability(group, 'line').recommendedDisplayMode).toBe('low_sample_table')
  })

  it('shortens long LP URLs for custom legends', () => {
    expect(shortenChartLabel('https://example.com/a/very/long/landing/page/path?utm=1', 24)).toMatch(/…$/)
  })
})

describe('BQ execution summary', () => {
  it('keeps backend query execution status in the report bundle', () => {
    const bundle = buildAdsReportBundle({
      setupState: {
        datasetId: 'analytics_123',
        periods: ['2026-05'],
        queryTypes: ['search', 'landing'],
      },
      results: [{
        period: '2026-05',
        report_md: '# May',
        execution_summary: [
          { query_type: 'search', status: 'success', row_count: 7, chart_group_count: 2, message: 'ok' },
          { query_type: 'landing', status: 'no_data', row_count: 0, chart_group_count: 0, message: 'empty' },
        ],
        chart_data: { groups: [makeGroup({ title: '検索クエリ', labels: ['a'], datasets: [{ label: 'v', data: [1] }] })] },
      }],
    })

    expect(bundle.executionSummary).toEqual([
      expect.objectContaining({ periodTag: '2026-05', queryType: 'search', status: 'success', rowCount: 7, chartGroupCount: 2 }),
      expect.objectContaining({ periodTag: '2026-05', queryType: 'landing', status: 'no_data', rowCount: 0, chartGroupCount: 0 }),
    ])
  })

  it('normalizes a single execution_summary object', () => {
    expect(pickExecutionSummary({
      execution_summary: { query_type: 'pv', status: 'no_chart', row_count: 5, chart_group_count: 0 },
    }, '2026-05')).toEqual([
      expect.objectContaining({ periodTag: '2026-05', queryType: 'pv', status: 'no_chart', rowCount: 5, chartGroupCount: 0 }),
    ])
  })
})

describe('buildChartEvidencePack', () => {
  it('builds deterministic evidence for multi-series daily trends', () => {
    const pack = buildChartEvidencePack([
      makeGroup({
        title: 'LP分析 — セッション数上位3LPの日別推移',
        chartType: 'line',
        labels: ['20260501', '20260502', '20260503'],
        datasets: [
          { label: '/a', data: [100, 150, 90] },
          { label: '/b', data: [50, null, 200] },
          { label: '/c', data: [10, 10, 10] },
        ],
        _periodTag: '2026-05',
      }),
    ], { scopeLabel: '2026-05' })

    expect(pack.version).toBe('chart_evidence_pack_v1')
    expect(pack.scope_label).toBe('2026-05')
    expect(pack.charts).toHaveLength(1)
    expect(pack.charts[0].chart_id).toBe('chart_01')
    expect(pack.charts[0].series_count).toBe(3)
    expect(pack.charts[0].missing_values).toBe(1)
    expect(pack.charts[0].series[0].latest).toEqual({
      label: '5/3',
      rawLabel: '20260503',
      aliases: ['20260503', '2026-05-03', '2026/5/3', '2026年5月3日', '5/3'],
      value: 90,
    })
    expect(pack.charts[0].series[0].points).toEqual([
      expect.objectContaining({ label: '5/1', rawLabel: '20260501', value: 100 }),
      expect.objectContaining({ label: '5/2', rawLabel: '20260502', value: 150 }),
      expect.objectContaining({ label: '5/3', rawLabel: '20260503', value: 90 }),
    ])
    expect(pack.charts[0].series[0].max).toEqual({
      label: '5/2',
      rawLabel: '20260502',
      aliases: ['20260502', '2026-05-02', '2026/5/2', '2026年5月2日', '5/2'],
      value: 150,
    })
    expect(pack.charts[0].series[0].total).toBe(340)
    expect(pack.charts[0].series[0].notable_swings.length).toBeGreaterThan(0)
  })

  it('keeps ranking top values and missing values in the evidence pack', () => {
    const pack = buildChartEvidencePack([
      makeGroup({
        title: '検索クエリ — 上位4語',
        chartType: 'bar_horizontal',
        labels: ['alpha', 'beta', 'gamma', 'delta'],
        datasets: [{ label: '検索回数', data: [40, 10, '', 30] }],
      }),
    ])

    expect(pack.charts[0].ranking_top.slice(0, 2)).toEqual([
      expect.objectContaining({ series_label: '検索回数', label: 'alpha', value: 40 }),
      expect.objectContaining({ series_label: '検索回数', label: 'delta', value: 30 }),
    ])
    expect(pack.total_missing_values).toBe(1)
  })
})

describe('selectChartGroupsForPrompt', () => {
  it('keeps the date-specific chart even when it is beyond the default evidence limit', () => {
    const groups = Array.from({ length: 30 }, (_, index) => {
      const day = String(30 - index).padStart(2, '0')
      return makeGroup({
        title: 'PV分析 — 日別推移',
        labels: [`202605${day}`],
        datasets: [{ label: 'PV数', data: [100 + index] }],
        _periodTag: `2026-05-${day}`,
      })
    })

    const selected = selectChartGroupsForPrompt(groups, '2026年5月7日のPV数を説明してください', {
      maxGroups: 6,
    })
    const pack = buildChartEvidencePack(selected, { maxCharts: 6 })

    expect(pack.charts.some((chart) =>
      chart.series.some((series) =>
        series.points.some((point) => point.rawLabel === '20260507'),
      ),
    )).toBe(true)
  })

  it('prioritizes traffic charts when the prompt asks about flow analysis', () => {
    const selected = selectChartGroupsForPrompt([
      makeGroup({ title: 'PV分析 — 日別推移', labels: ['20260521'], datasets: [{ label: 'PV数', data: [10] }] }),
      makeGroup({ title: '流入分析 — チャネル別セッション構成', labels: ['organic'], datasets: [{ label: 'セッション', data: [83] }] }),
    ], '流入分析のグラフから見るべき数値を教えて', { maxGroups: 1 })

    expect(selected[0].title).toContain('流入分析')
  })
})
