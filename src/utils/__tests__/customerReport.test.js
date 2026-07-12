import { describe, expect, it } from 'vitest'
import {
  buildCustomerReportViewModel,
  buildCustomerSimpleReport,
  getCustomerReportGaps,
  isCustomerReportV2,
  normalizeCustomerReportContract,
  replaceCustomerTerms,
} from '../customerReport'

function validReportV2(overrides = {}) {
  return {
    schema_version: 'report.v2',
    report_id: 'report-1',
    project_id: 'project-1',
    scope: {
      current_period: { start: '2026-06-01', end: '2026-06-30' },
      comparison_period: { start: '2026-05-01', end: '2026-05-31' },
      comparison_policy: 'previous_month',
      timezone: 'Asia/Tokyo',
      data_freshness: { status: 'fresh', last_observed_at: '2026-07-12T01:00:00Z' },
    },
    availability: {
      overall: 'full',
      metrics: [
        { key: 'visits', status: 'measured_zero', reason: null, last_observed_at: '2026-07-12T01:00:00Z' },
      ],
    },
    metrics: [
      {
        key: 'visits',
        label: 'セッション数',
        value: 0,
        unit: '件',
        aggregation: 'sum',
        comparison: { value: 12, absolute_change: -12, percent_change: -100, status: 'available' },
        evidence_key: 'evidence-visits',
      },
    ],
    conclusions: [
      {
        kind: 'what_happened',
        title: '訪問の変化を確認しました',
        body: '比較期間との差を確認します',
        severity: 'neutral',
        confidence: 'high',
        evidence_keys: ['evidence-visits'],
      },
    ],
    actions: [
      {
        title: '入口ページを確認する',
        confidence: 'medium',
        evidence_keys: ['evidence-visits'],
        priority: 'high',
        reason: '変化の理由を確認するためです',
        timeframe: '今日',
        success_metric: '訪問の変化',
      },
    ],
    evidence: [
      { key: 'evidence-visits', query_type: 'traffic', title: '流入チャネル', chart: null },
    ],
    caveats: [],
    generated_at: '2026-07-12T01:00:00Z',
    ...overrides,
  }
}

describe('customer-facing report contract', () => {
  it('adapts beginner_report_v1 only into a legacy-labelled view model', () => {
    const report = buildCustomerReportViewModel(
      {
        version: 'beginner_report_v1',
        summary_cards: [
          {
            type: 'so_what',
            title: 'LPを確認します',
            body: 'CVはまだ確認できません',
            severity: 'warning',
            evidence_chart_ids: ['chart_02'],
          },
          {
            type: 'what_happened',
            title: 'PVは増えています',
            body: 'ページビューの変化を確認しました',
            severity: 'positive',
            evidence_chart_ids: ['chart_01'],
          },
          {
            type: 'data_gap',
            title: 'GA4の接続を確認します',
            body: 'BigQueryに必要なデータがありません',
            severity: 'warning',
          },
        ],
        next_actions: [
          { priority: 'P1', title: 'CV計測を確認する', reason: '成果を判断するためです' },
        ],
        data_gaps: [
          { key: 'measurement', label: 'dataset_idを確認する', impact: '判断は保留です' },
        ],
        recommended_charts: ['chart_01', 'chart_02'],
      },
      {
        period: '2026-06',
        periodLabel: '2026年6月',
        generatedAt: '2026-07-12T00:00:00Z',
        chartGroups: [
          { queryType: 'pv', title: 'PV分析 — 日別推移' },
          { queryType: 'landing', title: 'LP分析 — 上位ページ' },
        ],
      },
    )

    expect(report).toMatchObject({
      source_schema: 'legacy.v1',
      scope: { period: '2026-06', period_label: '2026年6月' },
      availability: { state: 'ready' },
      generated_at: '2026-07-12T00:00:00Z',
    })
    expect(report.conclusions.map((item) => item.kind)).toEqual(['what_happened', 'so_what'])
    expect(report.conclusions[0].title).toBe('見られた回数は増えています')
    expect(report.actions[0]).toMatchObject({
      title: '問い合わせ・予約・購入などの成果計測を確認する',
      timeframe: 'today',
    })
    expect(report.evidence.map((item) => item.theme)).toEqual(['lp', 'lp'])
    expect(report.evidence[0].title).not.toContain('PV')
    expect(report.caveats.map((item) => `${item.title} ${item.body}`).join(' ')).not.toMatch(/GA4|BigQuery|dataset/i)
  })

  it('reports missing identity instead of inventing fields for an incomplete builder payload', () => {
    const result = normalizeCustomerReportContract({
      version: 'report.v2',
      report_id: 'report-1',
      period: '2026-06',
      analysis: { state: 'measured' },
      metrics: [],
    })

    expect(result.valid).toBe(false)
    expect(result.report).toBeNull()
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'project_id',
      'scope.timezone',
      'generated_at',
    ]))
    expect(isCustomerReportV2({ version: 'report.v2' })).toBe(false)
  })

  it('normalizes the current backend builder only when real missing values are supplied', () => {
    const result = normalizeCustomerReportContract(
      {
        version: 'report.v2',
        report_id: 'report-1',
        period: '2026-06',
        comparison_period: '2026-05',
        analysis: { query_type: 'traffic', state: 'measured' },
        metrics: [
          {
            key: 'visits',
            label: 'セッション数',
            unit: '件',
            aggregation: 'sum',
            current: { state: 'measured_zero', value: 0 },
            comparison: { state: 'measured', value: 12 },
            change: { state: 'decrease', absolute: -12, percent: -100 },
          },
        ],
        metadata: { generated_at: '2026-07-12T01:00:00Z' },
      },
      {
        projectId: 'project-1',
        timezone: 'Asia/Tokyo',
        evidence: [{ key: 'evidence-visits', query_type: 'traffic', title: '流入チャネル', chart: null }],
      },
    )

    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.report).toMatchObject({
      schema_version: 'report.v2',
      project_id: 'project-1',
      scope: {
        current_period: { start: '2026-06-01', end: '2026-06-30' },
        comparison_policy: 'previous_month',
      },
      metrics: [{ value: 0, evidence_key: 'evidence-visits' }],
    })
  })

  it('keeps the true contract separate from the customer-language view model', () => {
    const contract = validReportV2({
      availability: { ...validReportV2().availability, overall: 'partial' },
    })
    const normalized = normalizeCustomerReportContract(contract)
    const report = buildCustomerReportViewModel(normalized)

    expect(normalized.valid).toBe(true)
    expect(isCustomerReportV2(contract)).toBe(true)
    expect(isCustomerReportV2({ version: 'insight_report_v2' })).toBe(false)
    expect(report.source_schema).toBe('report.v2')
    expect(report.metrics[0].label).toBe('訪問数')
    expect(report.metrics[0].current).toEqual({ state: 'measured_zero', value: 0, reason: null })

    expect(report.availability).toEqual({
      state: 'partial',
      label: '一部確認中です',
      message: '一部のデータはまだ確認中です。確認できた範囲だけを表示します',
    })
    expect(report.evidence[0]).toMatchObject({
      theme: 'traffic',
      title: 'どこから来たか',
    })
    expect(getCustomerReportGaps(report)).toEqual([
      {
        key: 'availability_partial',
        title: '一部確認中です',
        body: '一部のデータはまだ確認中です。確認できた範囲だけを表示します',
        next_step: '期間または接続設定を確認する',
      },
    ])
  })

  it('rejects the AI report contract explicitly', () => {
    const result = normalizeCustomerReportContract({
      version: 'insight_report_v2',
      executive_summary: ['別契約'],
    })
    expect(result).toEqual({
      valid: false,
      issues: [{ path: 'schema_version', code: 'wrong_contract', message: 'report.v2 契約ではありません' }],
      report: null,
    })
    expect(buildCustomerReportViewModel({ version: 'insight_report_v2' })).toBeNull()
  })

  it('replaces common implementation vocabulary without changing internal identifiers', () => {
    expect(replaceCustomerTerms('page_views / sessions / API key / null')).toBe(
      '見られた回数 / 訪問 / 接続設定 / 未取得',
    )
  })
})

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
