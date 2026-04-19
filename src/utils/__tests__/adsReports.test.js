import { describe, it, expect } from 'vitest'
import { matchRelevantCharts } from '../adsReports'

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
