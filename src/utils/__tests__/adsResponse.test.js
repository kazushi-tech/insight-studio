import { describe, it, expect } from 'vitest'
import { extractInsightMeta, extractInsightReport } from '../adsResponse'

describe('extractInsightMeta', () => {
  it('returns null for empty input', () => {
    expect(extractInsightMeta('')).toBeNull()
    expect(extractInsightMeta(null)).toBeNull()
    expect(extractInsightMeta(undefined)).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(extractInsightMeta(123)).toBeNull()
    expect(extractInsightMeta({})).toBeNull()
    expect(extractInsightMeta([])).toBeNull()
  })

  it('returns null when the insight-meta block is missing', () => {
    expect(extractInsightMeta('ただのマークダウン本文\n- 項目1')).toBeNull()
  })

  it('returns null for invalid JSON inside the fenced block', () => {
    const md = '本文\n\n```insight-meta\n{ this is not json }\n```'
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('returns null when the JSON is not an object', () => {
    const md = '本文\n\n```insight-meta\n"some string"\n```'
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('parses a valid block with tldr / key_metrics / recommended_charts', () => {
    const md = [
      '## 分析結果',
      '本文テキスト',
      '',
      '```insight-meta',
      JSON.stringify({
        tldr: ['CTRが改善', 'CPAが悪化'],
        key_metrics: [
          { label: 'CTR', value: '3.5%', delta: 'up' },
          { label: 'CPA', value: '¥2,800', delta: 'down' },
        ],
        recommended_charts: ['CVR推移', 'CPA推移'],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta.tldr).toEqual(['CTRが改善', 'CPAが悪化'])
    expect(meta.key_metrics).toEqual([
      { label: 'CTR', value: '3.5%', delta: 'up' },
      { label: 'CPA', value: '¥2,800', delta: 'down' },
    ])
    expect(meta.recommended_charts).toEqual(['CVR推移', 'CPA推移'])
  })

  it('strips the insight-meta block from _strippedMarkdown', () => {
    const md = [
      '## 分析結果',
      '本文',
      '',
      '```insight-meta',
      JSON.stringify({ tldr: ['A'] }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta._strippedMarkdown).not.toContain('insight-meta')
    expect(meta._strippedMarkdown).toContain('## 分析結果')
    expect(meta._strippedMarkdown).toContain('本文')
  })

  it('filters out malformed tldr entries (non-strings)', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: ['OK', 123, null, { bad: true }, 'also ok'] }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.tldr).toEqual(['OK', 'also ok'])
  })

  it('filters out malformed key_metrics entries and invalid deltas', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        key_metrics: [
          { label: 'CTR', value: '3.5%', delta: 'up' },
          { label: 'missing value' },
          { value: 'missing label' },
          'not an object',
          { label: 'CPA', value: '¥2,800', delta: 'sideways' },
          { label: 'CVR', value: '1.2%' },
        ],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.key_metrics).toEqual([
      { label: 'CTR', value: '3.5%', delta: 'up' },
      { label: 'CPA', value: '¥2,800', delta: undefined },
      { label: 'CVR', value: '1.2%', delta: undefined },
    ])
  })

  it('filters out non-string recommended_charts entries', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        recommended_charts: ['OK', 42, null, { x: 1 }, 'also ok'],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.recommended_charts).toEqual(['OK', 'also ok'])
  })

  it('returns null when all three arrays are empty after filtering', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: [], key_metrics: [], recommended_charts: [] }),
      '```',
    ].join('\n')
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('returns null when all three arrays contain only malformed entries', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        tldr: [123, null],
        key_metrics: [{ label: 'noValue' }],
        recommended_charts: [{ x: 1 }],
      }),
      '```',
    ].join('\n')
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('ignores non-array fields gracefully', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: 'not an array', key_metrics: 'also not', recommended_charts: ['OK'] }),
      '```',
    ].join('\n')
    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta.tldr).toEqual([])
    expect(meta.key_metrics).toEqual([])
    expect(meta.recommended_charts).toEqual(['OK'])
  })
})

describe('extractInsightReport', () => {
  it('returns null for empty, non-string, or missing blocks', () => {
    expect(extractInsightReport('')).toBeNull()
    expect(extractInsightReport(null)).toBeNull()
    expect(extractInsightReport({})).toBeNull()
    expect(extractInsightReport('通常のMarkdownだけ')).toBeNull()
  })

  it('returns null for invalid JSON and non-object JSON', () => {
    expect(extractInsightReport('```insight-report\n{ bad json }\n```')).toBeNull()
    expect(extractInsightReport('```insight-report\n"nope"\n```')).toBeNull()
  })

  it('parses a valid HTML report block and strips internal fenced blocks', () => {
    const md = [
      '## 本文',
      '通常の説明',
      '',
      '```insight-report',
      JSON.stringify({
        summary: 'CVR低下はLP導線の影響が強い',
        metric_cards: [
          { label: 'CVR', value: '1.2%', delta: 'down', note: '前期比で悪化' },
          { label: 'CPA', value: '¥4,200', delta: 'up' },
          { label: 'bad' },
        ],
        findings: [
          { title: 'LP別CVR', body: '主要LPで低下', evidence: ['LP分析'] },
          '検索流入の質も要確認',
        ],
        risks: [{ title: 'CV未取得', body: '一部CVが未計測' }],
        actions: [{ label: 'P0', title: 'LP別CVRを確認', body: '悪化LPを特定', owner: '運用担当', due: '今日' }],
        evidence: ['CVR推移', 'LP分析'],
        recommended_charts: ['LP別CVR', '検索クエリ'],
      }),
      '```',
      '',
      '```insight-meta',
      JSON.stringify({ tldr: ['旧メタ'] }),
      '```',
    ].join('\n')

    const report = extractInsightReport(md)
    expect(report).not.toBeNull()
    expect(report.summary).toBe('CVR低下はLP導線の影響が強い')
    expect(report.metric_cards).toEqual([
      { label: 'CVR', value: '1.2%', delta: 'down', note: '前期比で悪化' },
      { label: 'CPA', value: '¥4,200', delta: 'up', note: '' },
    ])
    expect(report.findings).toEqual([
      { title: 'LP別CVR', body: '主要LPで低下', evidence: ['LP分析'], priority: '' },
      { title: '', body: '検索流入の質も要確認', evidence: [], priority: '' },
    ])
    expect(report.actions[0]).toMatchObject({
      label: 'P0',
      title: 'LP別CVRを確認',
      body: '悪化LPを特定',
      owner: '運用担当',
      due: '今日',
    })
    expect(report.evidence).toEqual(['CVR推移', 'LP分析'])
    expect(report.recommended_charts).toEqual(['LP別CVR', '検索クエリ'])
    expect(report._strippedMarkdown).toBe('## 本文\n通常の説明')
  })

  it('returns null when all legacy report fields are empty after normalization', () => {
    const md = [
      '```insight-report',
      JSON.stringify({
        summary: '',
        metric_cards: [{ label: 'missing value' }],
        findings: [null],
        risks: [{}],
        actions: [{ label: 'P0' }],
        evidence: [123],
        recommended_charts: [{}],
      }),
      '```',
    ].join('\n')
    expect(extractInsightReport(md)).toBeNull()
  })

  it('parses insight-report v2 and strips the fenced block', () => {
    const md = [
      '```insight-report',
      JSON.stringify({
        version: 'insight_report_v2',
        executive_summary: ['5/3にセッションが最大'],
        evidence_table: [
          { claim: 'セッション増加', metric: 'セッション', value: '200', period: '5/3', source: 'chart_01', confidence: 'high' },
        ],
        interpretation: ['LP /b が伸びています。'],
        hypotheses: [{ hypothesis: '流入増の可能性', evidence: 'chart_01', missing_data: 'source/medium別内訳' }],
        actions: [{ priority: 'P0', action: 'LP /b の流入元を確認', rationale: '最大値が出ている', expected_metric: 'セッション' }],
        limitations: ['広告費は未取得'],
        review_status: { verdict: 'pass', notes: ['数値根拠確認済み'] },
      }),
      '```',
      '',
      '## Markdown本文',
    ].join('\n')

    const report = extractInsightReport(md)
    expect(report).not.toBeNull()
    expect(report.executive_summary).toEqual(['5/3にセッションが最大'])
    expect(report.evidence_table[0]).toEqual(expect.objectContaining({
      claim: 'セッション増加',
      source: 'chart_01',
    }))
    expect(report.actions[0].priority).toBe('P0')
    expect(report._strippedMarkdown).toContain('## Markdown本文')
    expect(report._strippedMarkdown).not.toContain('insight-report')
  })

  it('parses raw insight-report v2 JSON responses', () => {
    const report = extractInsightReport(JSON.stringify({
      version: 'insight_report_v2',
      executive_summary: ['5/7はPV数328です'],
      evidence_table: [
        { claim: 'PV上昇', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
      ],
      interpretation: ['根拠数値だけで確認します。'],
      actions: [{ priority: 'P0', action: '流入元を確認', rationale: 'PV増加', expected_metric: 'PV数' }],
      limitations: ['CPAは未取得'],
      review_status: { verdict: 'pass', notes: ['数値照合済み'] },
      agent_trace: [{ stage: 'review_agent', status: 'completed', summary: '確認完了' }],
    }))

    expect(report).not.toBeNull()
    expect(report.executive_summary).toEqual(['5/7はPV数328です'])
    expect(report.evidence_table[0]).toEqual(expect.objectContaining({ value: '328', source: 'chart_01' }))
    expect(report.agent_trace).toHaveLength(1)
    expect(report._strippedMarkdown).toBe('')
  })

  it('extracts embedded raw insight-report v2 JSON from section-style responses', () => {
    const reportJson = JSON.stringify({
      version: 'insight_report_v2',
      executive_summary: ['5/7はchart_01でユーザー数273、セッション数308、PV数328です'],
      evidence_table: [
        { claim: 'PV分析 — 日別推移 の PV数 は 5/7 に 328 です', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
      ],
      interpretation: ['原因は仮説として扱います。'],
      limitations: ['CPA、ROAS、CTRは未取得'],
      review_status: { verdict: 'pass', notes: ['数値照合済み'] },
      agent_trace: [{ stage: 'review_agent', status: 'completed', summary: '確認完了' }],
    })
    const report = extractInsightReport(`## 原因\n\n${reportJson}\n\n## 次に見るべき数値\n\n${reportJson}`)

    expect(report).not.toBeNull()
    expect(report.executive_summary[0]).toContain('273')
    expect(report.evidence_table[0]).toEqual(expect.objectContaining({ source: 'chart_01', value: '328' }))
    expect(report.agent_trace).toHaveLength(1)
    expect(report._strippedMarkdown).toBe('## 原因\n\n\n\n## 次に見るべき数値')
  })

  it('extracts escaped embedded insight-report v2 JSON from rendered markdown text', () => {
    const reportJson = JSON.stringify({
      version: 'insight_report_v2',
      executive_summary: ['5/7はchart_01でユーザー数273、セッション数308、PV数328です'],
      evidence_table: [
        { claim: 'PV分析 — 日別推移 の ユーザー数 は 5/7 に 273 です', metric: 'ユーザー数', value: '273', period: '5/7', source: 'chart_01', confidence: 'high' },
      ],
      interpretation: ['原因は仮説として扱います。'],
      limitations: ['CPA、ROAS、CTRは未取得'],
      review_status: { verdict: 'pass', notes: ['数値照合済み'] },
      agent_trace: [
        {
          stage: 'data_evidence_agent',
          status: 'completed',
          excerpt: '根拠表\n| chart_id | value |\n| chart_01 | 328 |',
        },
      ],
    })
    const escapedReportJson = reportJson.replace(/"/g, '\\"')
    const report = extractInsightReport(`## 原因\n\n${escapedReportJson}\n\n## 次に見るべき数値\n\n${escapedReportJson}`)

    expect(report).not.toBeNull()
    expect(report.executive_summary[0]).toContain('308')
    expect(report.evidence_table[0]).toEqual(expect.objectContaining({ source: 'chart_01', value: '273' }))
    expect(report.agent_trace).toHaveLength(1)
    expect(report._strippedMarkdown).toBe('## 原因\n\n\n\n## 次に見るべき数値')
  })

  it('recovers malformed insight-report v2 JSON by dropping broken agent_trace payloads', () => {
    const aiContent =
      '## 原因\n\n' +
      '{"schema": "ads_ai", "version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で ユーザー数 273、セッション数 308、PV数 328 が確認できます。"], "evidence_table": [{"claim": "PV分析 — 日別推移 の PV数 は 5/7 に 328 です", "metric": "PV数", "value": "328", "period": "5/7", "source": "chart_01"}], "limitations": ["CPA、ROAS、CTRは未取得"], "agent_trace": [{"stage": "data_evidence_agent", "excerpt": "broken nested json\n\n' +
      '{"version": "insight_report_v2", "bad": true}' +
      '"}]}'

    const report = extractInsightReport(aiContent)

    expect(report).not.toBeNull()
    expect(report.executive_summary[0]).toContain('ユーザー数 273')
    expect(report.evidence_table[0]).toMatchObject({ metric: 'PV数', value: '328', source: 'chart_01' })
    expect(report.limitations).toContain('CPA、ROAS、CTRは未取得')
    expect(report.agent_trace).toHaveLength(0)
    expect(report._strippedMarkdown).toBe('')
  })

  it('recovers evidence rows from malformed markdown-table report artifacts', () => {
    const aiContent = [
      '{"version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で ユーザー数 273、セッション数 308、PV数 328 が確認できます。", "根拠は chart 表です',
      '| chart_id | title | metric | value | period |',
      '| --- | --- | --- | --- | --- |',
      '| chart_01 | PV分析 — 日別推移 | ユーザー数 | 273 | 5/7 |',
      '| chart_01 | PV分析 — 日別推移 | セッション数 | 308 | 5/7 |',
      '| chart_01 | PV分析 — 日別推移 | PV数 | 328 | 5/7 |',
      '未取得扱い: 広告費 / CPA / ROAS / CTR / CPC / インプレッションは入力に存在しない限り断定禁止。", "agent_trace": [{"stage": "data_evidence_agent", "excerpt": "broken"}]}',
    ].join('\n')

    const report = extractInsightReport(aiContent)

    expect(report).not.toBeNull()
    expect(report.executive_summary[0]).toContain('ユーザー数 273')
    expect(report.evidence_table).toHaveLength(3)
    expect(report.evidence_table[2]).toMatchObject({ source: 'chart_01', metric: 'PV数', value: '328', period: '5/7' })
    expect(report.limitations.join(' ')).toContain('CPA')
    expect(report.review_status.verdict).toBe('recovered')
    expect(report.agent_trace).toHaveLength(0)
  })

  it('returns null for malformed insight-report JSON', () => {
    expect(extractInsightReport('```insight-report\n{ invalid }\n```')).toBeNull()
  })
})
