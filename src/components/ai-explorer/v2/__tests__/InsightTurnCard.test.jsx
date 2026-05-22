import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsightTurnCard from '../InsightTurnCard'
import styles from '../AiExplorerV2.module.css'

/**
 * Spy on MarkdownRenderer to verify the correct variant is forwarded.
 * We don't want to depend on react-markdown's real render output for these
 * props-level assertions.
 */
vi.mock('../../../MarkdownRenderer', () => ({
  default: vi.fn(({ content, variant, size }) => (
    <div data-testid="markdown-renderer" data-variant={variant} data-size={size}>
      {content}
    </div>
  )),
}))

// Keep ChartGroupCard light for panel-rendering assertions.
vi.mock('../../../ads/ChartGroupCard', () => ({
  default: vi.fn(({ group }) => (
    <div data-testid="chart-group-card">{group?.title ?? ''}</div>
  )),
}))

describe('InsightTurnCard', () => {
  it('renders AI content via MarkdownRenderer with variant="ai-insight"', () => {
    render(
      <InsightTurnCard
        turn={{
          userPrompt: '直近のCVRの要因を教えて',
          aiContent: '## 分析結果\n- CTR上昇',
        }}
        size="large"
      />,
    )

    const md = screen.getByTestId('markdown-renderer')
    expect(md).toBeInTheDocument()
    expect(md).toHaveAttribute('data-variant', 'ai-insight')
    expect(md).toHaveAttribute('data-size', 'large')
    expect(md.textContent).toContain('## 分析結果')
  })

  it('shows the "AI 考察エンジン" label and aiTimestamp when provided', () => {
    render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'a',
          aiTimestamp: '2026-04-19 12:34',
        }}
      />,
    )
    expect(screen.getByText('AI 考察エンジン')).toBeInTheDocument()
    expect(screen.getByText('2026-04-19 12:34')).toBeInTheDocument()
  })

  it('applies the error class when turn.isError is true', () => {
    const { container } = render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'エラーが発生しました',
          isError: true,
        }}
      />,
    )
    const card = container.querySelector('[data-testid="insight-turn-card"]')
    expect(card).toBeInTheDocument()
    expect(card.className).toContain(styles.turnCardError)
  })

  it('omits the error class when turn.isError is false', () => {
    const { container } = render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'ok',
        }}
      />,
    )
    const card = container.querySelector('[data-testid="insight-turn-card"]')
    expect(card.className).not.toContain(styles.turnCardError)
  })

  it('does not render the chart panel when chartGroups is empty/undefined', () => {
    render(
      <InsightTurnCard
        turn={{ userPrompt: 'q', aiContent: 'CVR推移について' }}
      />,
    )
    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/関連データグラフを展開/)).not.toBeInTheDocument()
  })

  it('keeps graph bodies out of AI reports even when chartGroups match', () => {
    const group = {
      title: 'CVR推移',
      labels: ['W1', 'W2'],
      datasets: [{ label: 'CVR', data: [1, 2] }],
      chartType: 'line',
    }
    render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: '直近のCVR推移が改善しています。',
        }}
        chartGroups={[group]}
      />,
    )
    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/関連データグラフを展開/)).not.toBeInTheDocument()
    expect(screen.getByText(/直近のCVR推移が改善/)).toBeInTheDocument()
  })

  it('does not render the chart panel when no chartGroups match the content', () => {
    const group = {
      title: '全然関係ない',
      labels: ['W1'],
      datasets: [{ label: 'other', data: [1] }],
      chartType: 'line',
    }
    render(
      <InsightTurnCard
        turn={{ userPrompt: 'q', aiContent: '通常のテキストです' }}
        chartGroups={[group]}
      />,
    )
    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(screen.queryByText(/関連データグラフを展開/)).not.toBeInTheDocument()
  })

  it('renders the summary hero when insightMeta is provided as a prop', () => {
    render(
      <InsightTurnCard
        turn={{ userPrompt: 'q', aiContent: '## 本文' }}
        insightMeta={{
          tldr: ['CTR上昇'],
          key_metrics: [{ label: 'CTR', value: '3.5%', delta: 'up' }],
          recommended_charts: ['CVR推移'],
        }}
      />,
    )
    expect(screen.getByTestId('insight-summary-hero')).toBeInTheDocument()
    expect(screen.getByText('CTR上昇')).toBeInTheDocument()
    expect(screen.getByText('CTR')).toBeInTheDocument()
    expect(screen.getByText('CVR推移')).toBeInTheDocument()
  })

  it('auto-derives meta from aiContent containing a valid insight-meta block and renders the stripped markdown', () => {
    const aiContent = [
      '## 分析結果',
      '本文テキスト',
      '',
      '```insight-meta',
      JSON.stringify({
        tldr: ['要点1'],
        key_metrics: [{ label: 'CTR', value: '3.5%' }],
        recommended_charts: [],
      }),
      '```',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-summary-hero')).toBeInTheDocument()
    expect(screen.getByText('要点1')).toBeInTheDocument()

    const md = screen.getByTestId('markdown-renderer')
    expect(md.textContent).toContain('## 分析結果')
    expect(md.textContent).toContain('本文テキスト')
    expect(md.textContent).not.toContain('insight-meta')
  })

  it('prefers insight-report rendering and collapses the raw markdown detail', () => {
    const aiContent = [
      '## 分析結果',
      '本文テキスト',
      '',
      '```insight-report',
      JSON.stringify({
        summary: 'CVR低下はLP導線の影響が強い',
        metric_cards: [{ label: 'CVR', value: '1.2%', delta: 'down' }],
        findings: [{ title: 'LP別CVR', body: '主要LPで低下' }],
        actions: [{ label: 'P0', title: 'LP別CVRを確認' }],
      }),
      '```',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-html-report')).toBeInTheDocument()
    expect(screen.getByText('CVR低下はLP導線の影響が強い')).toBeInTheDocument()
    expect(screen.queryByTestId('insight-summary-hero')).not.toBeInTheDocument()
    expect(screen.getByText('詳細なAI回答を開く')).toBeInTheDocument()

    const md = screen.getByTestId('markdown-renderer')
    expect(md.textContent).toContain('## 分析結果')
    expect(md.textContent).not.toContain('insight-report')
  })

  it('renders no hero and preserves original aiContent when no meta block is present', () => {
    const aiContent = '## 普通のレポート\n- 項目A'
    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.queryByTestId('insight-summary-hero')).not.toBeInTheDocument()
    const md = screen.getByTestId('markdown-renderer')
    expect(md.textContent).toContain('## 普通のレポート')
    expect(md.textContent).toContain('項目A')
  })

  it('renders no hero and preserves aiContent when insight-meta JSON is malformed', () => {
    const aiContent = '## レポート\n\n```insight-meta\n{ invalid json }\n```'
    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.queryByTestId('insight-summary-hero')).not.toBeInTheDocument()
    // Markdown passes through unchanged — fenced block still visible as-is
    const md = screen.getByTestId('markdown-renderer')
    expect(md.textContent).toContain('## レポート')
  })

  it('renders operational cards from sectioned AI markdown', () => {
    const aiContent = [
      '## 原因',
      '- 指名キャンペーンのCVRが低下しています',
      '## 広告運用上の示唆',
      '- LPと広告文の訴求がずれています',
      '## 次に見るべき数値',
      '- CPAとLP-CVRを日次で確認',
      '## 今週やる施策',
      '- 広告文とFVコピーを揃える',
      '## 期待KPI',
      '- LP-CVRを5%改善',
    ].join('\n')
    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('operational-insight-cards')).toBeInTheDocument()
    expect(screen.getByText('原因')).toBeInTheDocument()
    expect(screen.getByText('広告運用上の示唆')).toBeInTheDocument()
    expect(screen.getByText('次に見るべき数値')).toBeInTheDocument()
    expect(screen.getByText('今週やる施策')).toBeInTheDocument()
    expect(screen.getByText('期待KPI')).toBeInTheDocument()
  })

  it('does not promote missing ad KPIs into the auto metric table', () => {
    const aiContent = [
      '## 制約',
      '- CPA、CVR、ROAS、広告費はGA4入力に含まれないため未取得です。',
      '## 観測事実',
      '- セッションは200件です。',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByText('根拠指標テーブル')).toBeInTheDocument()
    expect(screen.queryByText('CPA')).not.toBeInTheDocument()
    expect(screen.queryByText('CVR')).not.toBeInTheDocument()
    expect(screen.getByText('セッション')).toBeInTheDocument()
  })

  it('renders insight-report v2 as a structured evidence report without KPI fallbacks', () => {
    const aiContent = [
      '```insight-report',
      JSON.stringify({
        version: 'insight_report_v2',
        executive_summary: ['5/3のセッションが最大です'],
        evidence_table: [
          { claim: 'LP /a が最大', metric: 'セッション', value: '200', period: '5/3', source: 'chart_01', confidence: 'high' },
        ],
        interpretation: ['LP /a の伸びを優先して確認します。'],
        hypotheses: [{ hypothesis: '検索流入増の可能性', evidence: 'chart_01', missing_data: 'source/medium別内訳' }],
        actions: [{ priority: 'P0', action: 'LP /a の流入元を確認', rationale: '最大値が出ている', expected_metric: 'セッション' }],
        limitations: ['広告費は未取得'],
        review_status: { verdict: 'pass', notes: ['数値根拠確認済み'] },
      }),
      '```',
      '',
      '## 本文',
      'chart_01 のセッション 200 を根拠にします。',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('重要結論')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByText(/LP \/a の流入元を確認/)).toBeInTheDocument()
    expect(screen.queryByText('CPA / ROAS')).not.toBeInTheDocument()
    expect(screen.queryByText('CV / CVR')).not.toBeInTheDocument()
  })

  it('renders evidence status and agent trace for insight-report v2', () => {
    const agentTrace = [
      {
        stage: 'data_evidence_agent',
        label: 'Data Evidence Agent',
        status: 'completed',
        mode: 'deterministic_fallback',
        summary: 'chart_id と数値を照合しました。',
        checks: ['chart_id抽出', '根拠数値抽出'],
        issues: [],
        excerpt: 'chart_01',
      },
      {
        stage: 'senior_adops_reviewer_agent',
        label: 'Senior AdOps Reviewer Agent',
        status: 'completed',
        mode: 'llm_stage',
        summary: '実務確認順を検査しました。',
        checks: ['実務妥当性'],
        issues: [],
        excerpt: 'P0/P1/P2',
      },
    ]
    const aiContent = [
      '```insight-report',
      JSON.stringify({
        version: 'insight_report_v2',
        executive_summary: ['5/7はchart_01でPV数328です'],
        evidence_table: [
          { claim: 'PV分析 — 日別推移 の PV数 は 5/7 に 328 です', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
        ],
        interpretation: ['初心者向けにPV数を見ます。', 'シニア広告運用観点で流入元を確認します。'],
        hypotheses: [{ hypothesis: '流入増の仮説', evidence: 'chart_01', missing_data: '広告費' }],
        actions: [{ priority: 'P0', action: '流入元を確認', rationale: 'PV数328', expected_metric: 'PV数' }],
        limitations: ['CPA、ROAS、CTRは未取得'],
        review_status: {
          verdict: 'pass',
          notes: ['8つの役割で順番に検査', '数値照合済み'],
          blocking_issues: [],
          checked_items: ['chart_id', '値', '期間'],
          unsupported_kpis: ['CPA', 'ROAS', 'CTR'],
          evidence_consistency: { chart_id_checked: true },
        },
        agent_trace: agentTrace,
      }),
      '```',
      'chart_01 の PV数 328 を根拠にします。',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('数値照合済み')
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('chart_id: chart_01')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('複数ステージAIレビュー')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('Data Evidence Agent')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('deterministic_fallback')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('llm_stage')
  })

  it('keeps insight-report v2 compact and avoids inline chart expansion', () => {
    const aiContent = [
      '```insight-report',
      JSON.stringify({
        version: 'insight_report_v2',
        executive_summary: ['5/7のPV数は328です'],
        evidence_table: [
          { claim: '5/7のPVが確認できます', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
        ],
        interpretation: ['PV分析 — 日別推移を参照しています。'],
        hypotheses: [],
        actions: [],
        limitations: [],
        review_status: { verdict: 'pass', notes: ['数値根拠確認済み'] },
      }),
      '```',
      '',
      'PV分析 — 日別推移 の chart_01 を参照しています。',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getAllByText(/328/).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('referenced-chart-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
  })
})
