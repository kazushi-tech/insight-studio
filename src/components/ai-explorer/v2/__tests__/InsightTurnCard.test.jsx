import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
        interpretation: ['まず前提としてPV数を見ます。', '広告運用上は流入元を確認します。'],
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
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('参照グラフ: chart_01')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('根拠と整合性の確認')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('数値根拠の確認')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('自動照合')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('AI確認')
    expect(screen.getByTestId('agent-trace-panel')).not.toHaveTextContent('deterministic_fallback')
    expect(screen.getByTestId('agent-trace-panel')).not.toHaveTextContent('llm_stage')
  })

  it('renders embedded raw insight-report v2 JSON as a structured report', () => {
    const reportJson = JSON.stringify({
      version: 'insight_report_v2',
      executive_summary: ['5/7はchart_01でユーザー数273、セッション数308、PV数328です'],
      evidence_table: [
        { claim: 'PV分析 — 日別推移 の ユーザー数 は 5/7 に 273 です', metric: 'ユーザー数', value: '273', period: '5/7', source: 'chart_01', confidence: 'high' },
        { claim: 'PV分析 — 日別推移 の セッション数 は 5/7 に 308 です', metric: 'セッション数', value: '308', period: '5/7', source: 'chart_01', confidence: 'high' },
        { claim: 'PV分析 — 日別推移 の PV数 は 5/7 に 328 です', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
      ],
      interpretation: ['まず前提としてPV、セッション、ユーザーを分けて確認します。'],
      hypotheses: [{ hypothesis: '流入増の可能性', evidence: 'chart_01', missing_data: '広告媒体別データ' }],
      actions: [{ priority: 'P0', action: '流入元を確認', rationale: '3指標が同日に増加', expected_metric: 'PV数' }],
      limitations: ['CPA、ROAS、CTRは未取得'],
      review_status: { verdict: 'pass', notes: ['数値照合済み'], unsupported_kpis: ['CPA', 'ROAS', 'CTR'] },
      agent_trace: [{ stage: 'review_agent', label: 'Review Agent', status: 'completed', mode: 'deterministic_fallback', summary: '数値照合済み' }],
    })
    const aiContent = `## 原因\n\n${reportJson}\n\n## 次に見るべき数値\n\n${reportJson}`

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('参照グラフ: chart_01')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('整合性チェック')
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.queryByText(reportJson)).not.toBeInTheDocument()
  })

  it('renders escaped embedded insight-report v2 JSON as a structured report', () => {
    const reportJson = JSON.stringify({
      version: 'insight_report_v2',
      executive_summary: ['5/7はchart_01でユーザー数273、セッション数308、PV数328です'],
      evidence_table: [
        { claim: 'PV分析 — 日別推移 の ユーザー数 は 5/7 に 273 です', metric: 'ユーザー数', value: '273', period: '5/7', source: 'chart_01', confidence: 'high' },
      ],
      interpretation: ['まず前提としてPV、セッション、ユーザーを分けて確認します。'],
      actions: [{ priority: 'P0', action: '流入元を確認', rationale: '3指標が同日に増加', expected_metric: 'PV数' }],
      limitations: ['CPA、ROAS、CTRは未取得'],
      review_status: { verdict: 'pass', notes: ['数値照合済み'], unsupported_kpis: ['CPA', 'ROAS', 'CTR'] },
      agent_trace: [{ stage: 'review_agent', label: 'Review Agent', status: 'completed', mode: 'deterministic_fallback', summary: '数値照合済み' }],
    })
    const escapedReportJson = reportJson.replace(/"/g, '\\"')
    const aiContent = `## 原因\n\n${escapedReportJson}\n\n## 次に見るべき数値\n\n${escapedReportJson}`

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('参照グラフ: chart_01')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('整合性チェック')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.queryByText(escapedReportJson)).not.toBeInTheDocument()
  })

  it('recovers malformed internal insight-report artifacts instead of rendering raw JSON cards', () => {
    const malformedArtifact =
      '## 原因\n\n' +
      '{"schema": "ads_ai", "version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で ユーザー数 273、セッション数 308、PV数 328 が確認できます。"], "evidence_table": [{"claim": "PV分析 — 日別推移 の ユーザー数 は 5/7 に 273 です", "metric": "ユーザー数", "value": "273", "period": "5/7", "source": "chart_01"}], "limitations": ["CPA、ROAS、CTRは未取得"], "agent_trace": [{"stage": "data_evidence_agent", "excerpt": "Data Evidence Agent: 引用可能な数値\n\n' +
      '{"version": "insight_report_v2", "bad": true}' +
      '"}]}\n\n' +
      '## 次に見るべき数値\n\n' +
      '{"version": "insight_report_v2", "agent_trace": [{"stage": "review_agent"}]}'

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent: malformedArtifact }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('CPA、ROAS、CTRは未取得')
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
    expect(screen.queryByTestId('operational-insight-cards')).not.toBeInTheDocument()
    expect(screen.queryByTestId('insight-report-flow')).not.toBeInTheDocument()
    expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
    expect(screen.queryByText(/\{"version"/)).not.toBeInTheDocument()
  })

  it('hides malformed insight-report fenced blocks that cannot be parsed', () => {
    const aiContent = '## レポート\n\n```insight-report\n{ invalid json }\n```\n\nこの行も内部ブロックに付随するため表示しない'

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-artifact-hidden')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
    expect(screen.queryByText(/invalid json/)).not.toBeInTheDocument()
  })

  it('renders a safe recovered report from chart groups when malformed artifacts cannot be parsed', () => {
    const chartGroups = [{
      title: 'PV分析 — 日別推移',
      chartType: 'line',
      labels: ['20260507'],
      datasets: [
        { label: 'ユーザー数', data: [273] },
        { label: 'セッション数', data: [308] },
        { label: 'PV数', data: [328] },
      ],
    }, {
      title: '異常検知 — メトリクス推移',
      chartType: 'line',
      labels: ['20260507'],
      datasets: [
        { label: 'PV', data: [328] },
      ],
    }, {
      title: 'LP分析 — セッション数上位5LPの日別推移',
      chartType: 'line',
      labels: ['20260507'],
      datasets: [
        { label: 'www.petabit.co.jp/news/2026/8900/', data: [5] },
      ],
    }]
    const aiContent = '```insight-report\n{ invalid json with "version": "insight_report_v2" }\n```'
    const userPrompt = '2026年5月7日のPV数328、セッション数308、ユーザー数273が上がった理由を、根拠テーブルと未取得KPIの扱いも含めて考察してください。'

    render(<InsightTurnCard turn={{ userPrompt, aiContent }} chartGroups={chartGroups} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('参照グラフ: chart_01')
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('取得済みグラフ根拠で照合済み')
    expect(screen.getByTestId('evidence-status-band')).not.toHaveTextContent('数値照合は要確認')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('ユーザー数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('273')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('セッション数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('308')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('PV数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('まず前提として')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('広告運用上は')
    expect(screen.getByTestId('insight-report-v2')).not.toHaveTextContent('初心者向け')
    expect(screen.getByTestId('insight-report-v2')).not.toHaveTextContent('シニア運用者向け')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('1セッションあたりPV')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('P3: 媒体管理画面で配信変更履歴を突合する')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('数値根拠の確認')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('運用観点の確認')
    expect(screen.getByTestId('agent-trace-panel')).not.toHaveTextContent('Data Evidence Agent')
    expect(screen.getByTestId('agent-trace-panel')).not.toHaveTextContent('Senior AdOps Reviewer Agent')
    expect(screen.queryByText('www.petabit.co.jp/news/2026/8900/')).not.toBeInTheDocument()
    expect(screen.queryByText('chart_02')).not.toBeInTheDocument()
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
    expect(screen.queryByText(/invalid json/)).not.toBeInTheDocument()
  })

  it('renders recovered table rows from malformed report artifacts', () => {
    const aiContent = [
      '{"version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で ユーザー数 273、セッション数 308、PV数 328 が確認できます。", "根拠は chart 表です',
      '| chart_id | title | metric | value | period |',
      '| --- | --- | --- | --- | --- |',
      '| chart_01 | PV分析 — 日別推移 | ユーザー数 | 273 | 5/7 |',
      '| chart_01 | PV分析 — 日別推移 | セッション数 | 308 | 5/7 |',
      '| chart_01 | PV分析 — 日別推移 | PV数 | 328 | 5/7 |',
      '未取得扱い: 広告費 / CPA / ROAS / CTR / CPC / インプレッションは入力に存在しない限り断定禁止。", "agent_trace": [{"stage": "data_evidence_agent", "excerpt": "broken"}]}',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('PV数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
    expect(screen.queryByText(/\{"version"/)).not.toBeInTheDocument()
  })

  it('renders recovered table rows when malformed artifacts omit agent_trace', () => {
    const aiContent = '{"version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で PV数 328 が確認できます。", "\\n| chart_id | title | metric | value | period |\\n| --- | --- | --- | --- | --- |\\n| chart_01 | PV分析 — 日別推移 | PV数 | 328 | 5/7 |\\n未取得扱い: CPA / ROAS / CTR は入力に存在しない限り断定禁止。"]'

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('PV数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
  })

  it('recovers json-like evidence rows from malformed report artifacts', () => {
    const aiContent = [
      '{"version": "insight_report_v2", "executive_summary": ["5/7 は chart_01 で ユーザー数 273、セッション数 308、PV数 328 が確認できます。',
      '"evidence_table": [',
      '{"claim": "PV分析 — 日別推移 の ユーザー数 は 5/7 に 273 です", "metric": "ユーザー数", "value": "273", "period": "5/7", "source": "chart_01"},',
      '{"claim": "PV分析 — 日別推移 の セッション数 は 5/7 に 308 です", "metric": "セッション数", "value": "308", "period": "5/7", "source": "chart_01"},',
      '{"claim": "PV分析 — 日別推移 の PV数 は 5/7 に 328 です", "metric": "PV数", "value": "328", "period": "5/7", "source": "chart_01"}',
      '], "limitations": ["未取得扱い: CPA / ROAS / CTR は入力に存在しない限り断定禁止。"], "agent_trace": [{"stage": "data_evidence_agent", "excerpt": "broken',
      '{"version": "insight_report_v2"}',
      '"}]}',
    ].join('\n')

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    expect(screen.getByTestId('insight-report-v2')).toBeInTheDocument()
    expect(screen.getByText('根拠テーブル')).toBeInTheDocument()
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('ユーザー数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('273')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('セッション数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('308')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('PV数')
    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('328')
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
  })

  it('does not hide normal prose that mentions agent_trace without a JSON key', () => {
    const aiContent = '## 調査メモ\nagent_trace という語を説明していますが、内部JSONではありません。'

    render(<InsightTurnCard turn={{ userPrompt: 'q', aiContent }} />)

    const md = screen.getByTestId('markdown-renderer')
    expect(md.textContent).toContain('agent_trace という語を説明')
    expect(screen.queryByTestId('insight-report-artifact-hidden')).not.toBeInTheDocument()
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

  it('renders response metadata, fallback notice, caveats, and retry action', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <InsightTurnCard
        turn={{
          userPrompt: '5月のPV最大日は？',
          aiContent: '## 結論\n最大日は5月3日です。',
          fallbackNotice: '形式整形に失敗したため、AIの生回答を表示しています。',
          caveats: ['外部施策の有無は確認できません'],
          analysisContext: {
            dateRange: { start: '2026-05-01', end: '2026-05-31' },
            metricFocus: 'page_views',
            sessionLandingPageDiagnostic: {
              method: 'ga4_session_first_page_view',
              sessionKeyMethod: 'user_pseudo_id + ga_session_id',
              landingPageDefinition: 'first page_view.page_location in each GA4 session',
            },
          },
        }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByTestId('ai-response-meta')).toBeInTheDocument()
    expect(screen.getByText(/2026-05-01 〜 2026-05-31/)).toBeInTheDocument()
    expect(screen.getByText(/page_views/)).toBeInTheDocument()
    expect(screen.getByText(/GA4セッション内の最初のpage_view/)).toBeInTheDocument()
    expect(screen.getByText(/生回答を表示/)).toBeInTheDocument()
    expect(screen.getByText('外部施策の有無は確認できません')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
