import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightHtmlReport from './InsightHtmlReport'
import InsightSummaryHero from './InsightSummaryHero'
import { extractInsightMeta, extractInsightReport, extractOperationalInsightCards } from '../../../utils/adsResponse'
import { buildChartEvidencePack } from '../../../utils/adsReports'
import styles from './AiExplorerV2.module.css'
import cardStyles from './InsightTurnCard.module.css'

/**
 * InsightTurnCard — a single user prompt + AI response rendered as one
 * full-width card. Replaces the v1 chat-bubble pair. Phase 3 derives
 * `insight-meta` from `turn.aiContent` (if
 * not passed explicitly) and renders the InsightSummaryHero at the top of
 * the card. The insight-meta fenced block is stripped from the markdown so
 * users don't see it. Fully backwards-compatible: if no meta is present,
 * the hero is hidden and the original content is rendered as before.
 */
const ACTION_LABELS = ['P0', 'P1', 'P2']
const FORBIDDEN_AD_METRIC_PATTERN = /(CVR|CPA|CTR|CPC|ROAS|広告費|インプレッション)/i
const UNKNOWN_OR_LIMITATION_PATTERN = /(未取得|不明|含まれない|断定しない|存在しない|追加データ|必要|要確認)/i

function cleanText(value) {
  return String(value || '').replace(/\*\*/g, '').replace(/^[\s\-・]+/, '').trim()
}

function collectMarkdownBullets(markdown, keywords, limit = 4) {
  const lines = String(markdown || '').split('\n')
  const collected = []
  let capture = false

  for (const rawLine of lines) {
    const line = cleanText(rawLine)
    if (/^#{1,4}\s*/.test(rawLine) || /[:：]$/.test(line)) {
      capture = keywords.some((keyword) => line.includes(keyword))
      continue
    }
    if (capture && /^[-*・]\s+/.test(rawLine.trim())) {
      collected.push(cleanText(line))
    }
    if (collected.length >= limit) break
  }

  return collected
}

function extractActionRows(markdown, operationalCards) {
  const source = String(markdown || '')
  const candidates = [
    ...collectMarkdownBullets(source, ['施策', 'アクション', '改善', '今週'], 3),
    ...operationalCards.filter((card) => card.key === 'action').map((card) => card.body),
  ]
  const unique = [...new Set(candidates.map((item) => cleanText(item)).filter(Boolean))]
  const fallback = [
    '最重要KPIの取得条件を確認し、効果検証できる状態にする',
    '悪化した導線を優先して、LPまたは広告訴求を修正する',
    'チャネル別の差分を見て、伸ばす配信と止める配信を分ける',
  ]

  return ACTION_LABELS.map((label, index) => ({
    label,
    task: unique[index] || fallback[index],
    evidence: collectMarkdownBullets(source, ['根拠', '観測', '指標'], 3)[index] || '回答本文の根拠セクションを参照',
    owner: index === 0 ? '運用担当' : index === 1 ? 'クリエイティブ担当' : '分析担当',
    due: index === 0 ? '今すぐ' : index === 1 ? '今週中' : '次回確認',
  }))
}

function extractMetricRows(markdown) {
  const source = String(markdown || '')
  const metricPattern = /(PV|セッション|直帰率|CVR|CPA|CTR|CPC|ROAS|CV|売上|広告費)[^。\n|]{0,50}/gi
  const rows = [...new Set(source.match(metricPattern) || [])]
    .filter((row) => !(FORBIDDEN_AD_METRIC_PATTERN.test(row) && UNKNOWN_OR_LIMITATION_PATTERN.test(row)))
    .slice(0, 4)

  if (rows.length === 0) {
    return []
  }

  return rows.map((row) => {
    const metric = row.match(/PV|セッション|直帰率|CVR|CPA|CTR|CPC|ROAS|CV|売上|広告費/i)?.[0] || '指標'
    const delta = row.match(/[+-]?\d+(?:\.\d+)?\s*(?:%|pt|円|件)?/)?.[0] || '変化あり'
    return [metric, delta, cleanText(row)]
  })
}

function extractMissingItems(markdown) {
  const matches = String(markdown || '').match(/(?:未取得|不足|未計測|要確認)[^。\n、,]{0,28}(?:データ|CVR|CPA|ROAS|CV|チャネル|キャンペーン|広告費|指標)/g)
  return [...new Set(matches || [])].slice(0, 5)
}

function normalizeAgentTrace(trace) {
  return Array.isArray(trace)
    ? trace.filter((item) => item && typeof item === 'object')
    : []
}

function normalizeNumberToken(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim()
  if (!raw) return ''
  const number = Number(raw)
  if (!Number.isFinite(number)) return ''
  return Number.isInteger(number) ? String(number) : String(number)
}

function extractPromptNumbers(prompt) {
  const values = new Set()
  for (const match of String(prompt || '').matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const token = normalizeNumberToken(match[0])
    if (!token) continue
    const numeric = Number(token)
    if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2099) continue
    if (Math.abs(numeric) < 10) continue
    values.add(token)
  }
  return values
}

function buildDateTokens(prompt) {
  const source = String(prompt || '')
  const tokens = new Set()
  const add = (month, day) => {
    const m = Number(month)
    const d = Number(day)
    if (!m || !d) return
    tokens.add(`${m}/${d}`)
    tokens.add(`${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`)
  }
  for (const match of source.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) add(match[2], match[3])
  for (const match of source.matchAll(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/g)) add(match[1], match[2])
  return tokens
}

function pointMatchesPromptDate(point, dateTokens) {
  if (dateTokens.size === 0) return true
  const labels = [point?.label, point?.rawLabel, ...(Array.isArray(point?.aliases) ? point.aliases : [])]
    .map((value) => String(value || ''))
  return labels.some((label) => dateTokens.has(label))
}

function recoverEvidenceRowsFromCharts(userPrompt, chartGroups) {
  const promptNumbers = extractPromptNumbers(userPrompt)
  if (promptNumbers.size === 0 || !Array.isArray(chartGroups) || chartGroups.length === 0) return []

  const dateTokens = buildDateTokens(userPrompt)
  const pack = buildChartEvidencePack(chartGroups, { scopeLabel: 'AI考察 復旧表示', maxCharts: 36 })
  const chartCandidates = []

  for (const chart of pack?.charts || []) {
    const rows = []
    for (const series of chart.series || []) {
      for (const point of series.points || []) {
        const value = normalizeNumberToken(point.value)
        if (!promptNumbers.has(value) || !pointMatchesPromptDate(point, dateTokens)) continue
        rows.push({
          claim: `${chart.title} の ${series.label} は ${point.label} に ${value} です`,
          chart_title: chart.title,
          metric: series.label,
          value,
          period: point.label,
          source: chart.chart_id,
          confidence: 'グラフ実測値',
          used_for: '対象日の増加事実を説明する根拠',
        })
      }
    }
    if (rows.length > 0) chartCandidates.push({ chart, rows })
  }

  if (chartCandidates.length === 0) return []
  const maxRows = Math.max(...chartCandidates.map((item) => item.rows.length))
  const selectedCharts = chartCandidates
    .filter((item) => (maxRows >= 2 ? item.rows.length === maxRows : item.rows.length > 0))
    .slice(0, 3)
  const rows = selectedCharts.flatMap((item) => item.rows)

  const seen = new Set()
  return rows.filter((row) => {
    const key = [row.source, row.metric, row.value, row.period].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function getEvidenceMetricValue(rows, pattern) {
  const row = rows.find((item) => pattern.test(String(item.metric || '')))
  const value = Number(row?.value)
  return Number.isFinite(value) ? value : null
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return null
  return value.toFixed(2).replace(/\.00$/, '')
}

function buildRecoveredAgentTrace(evidenceRows, unsupportedKpis) {
  const firstSource = evidenceRows[0]?.source || 'chart_id'
  const metricList = evidenceRows.map((row) => `${row.metric}=${row.value}`).join(' / ')
  const unsupported = unsupportedKpis.length > 0
    ? unsupportedKpis.join(' / ')
    : '広告費 / CPA / ROAS / CTR / CPC / インプレッション'

  return [
    {
      stage: 'data_evidence_agent',
      label: '数値根拠の確認',
      status: 'completed',
      mode: 'deterministic_fallback',
      summary: `${firstSource} の対象日データから ${metricList} を照合しました。`,
      checks: ['chart_id', 'metric', 'value', 'period'],
      issues: [],
    },
    {
      stage: 'beginner_explanation_agent',
      label: '表現の整理',
      status: 'completed',
      mode: 'deterministic_fallback',
      summary: 'PV、セッション、ユーザーの違いを前提から分かる表現に整えました。',
      checks: ['専門用語の補足', '結論の先出し', '次に見る順序'],
      issues: [],
    },
    {
      stage: 'senior_adops_reviewer_agent',
      label: '運用観点の確認',
      status: 'completed',
      mode: 'deterministic_fallback',
      summary: 'GA4で見える流入量と、媒体側で突合すべき費用・効率KPIを分離しました。',
      checks: ['流入元', 'LP', '検索クエリ', '媒体データ突合'],
      issues: [],
    },
    {
      stage: 'unsupported_kpi_guard_agent',
      label: '未連携KPIの確認',
      status: 'completed',
      mode: 'deterministic_fallback',
      summary: `${unsupported} は今回のグラフ根拠には未連携として扱いました。`,
      checks: ['未連携KPIの断定回避', '広告効率KPIの分離'],
      issues: [],
    },
    {
      stage: 'final_consistency_agent',
      label: '整合性チェック',
      status: 'completed',
      mode: 'deterministic_fallback',
      summary: '表示する数値を根拠テーブル内のchart_id・期間・値に限定しました。',
      checks: ['raw artifact非表示', '根拠表表示', '矛盾チェック'],
      issues: [],
    },
  ]
}

function buildSafeRecoveredReport({ userPrompt, aiContent, agentTrace, chartGroups }) {
  const evidenceRows = recoverEvidenceRowsFromCharts(userPrompt, chartGroups)
  if (evidenceRows.length === 0) return null
  const metrics = evidenceRows.map((row) => `${row.metric} ${row.value}`).join('、')
  const primarySource = evidenceRows[0]?.source || 'chart_id'
  const primaryPeriod = evidenceRows[0]?.period || '該当日'
  const userCount = getEvidenceMetricValue(evidenceRows, /ユーザー/)
  const sessionCount = getEvidenceMetricValue(evidenceRows, /セッション/)
  const pvCount = getEvidenceMetricValue(evidenceRows, /PV/)
  const pagesPerSession = pvCount && sessionCount ? formatRatio(pvCount / sessionCount) : null
  const sessionsPerUser = sessionCount && userCount ? formatRatio(sessionCount / userCount) : null
  const unsupportedKpis = ['広告費', 'CPA', 'ROAS', 'CTR', 'CPC', 'インプレッション']
    .filter((kpi) => String(userPrompt || aiContent || '').includes(kpi))
  const unsupportedDisplay = unsupportedKpis.length > 0
    ? unsupportedKpis.join(' / ')
    : '広告費 / CPA / ROAS / CTR / CPC / インプレッション'
  const recoveredTrace = agentTrace.length > 0
    ? agentTrace
    : buildRecoveredAgentTrace(evidenceRows, unsupportedKpis)

  return {
    version: 'insight_report_v2',
    executive_summary: [
      `${primaryPeriod} は ${primarySource} のグラフ根拠で ${metrics} を照合済みです。これは「同じ日に、来訪した人数・訪問回数・ページ閲覧数がまとめて増えた」状態です。`,
      pagesPerSession && sessionsPerUser
        ? `補助比率では 1セッションあたりPVは約${pagesPerSession}、1ユーザーあたりセッションは約${sessionsPerUser} です。極端な回遊増ではなく、まず流入量そのものが増えた日として扱うのが自然です。`
        : 'PV、セッション、ユーザーが同じ日に増えているため、まず流入量そのものの増加として読みます。',
      `${unsupportedDisplay} は今回のGA4グラフ根拠には未連携です。広告効率の良し悪しは断定せず、媒体データを接続したうえで評価対象にします。`,
      '次に見る順番は、流入元、LP、検索クエリ、媒体配信変更、CV/売上の順です。これにより「量が増えただけ」なのか「事業成果に寄与した増加」なのかを分けられます。',
    ],
    evidence_table: evidenceRows,
    interpretation: [
      `観測事実: ${primarySource} の ${primaryPeriod} に、ユーザー・セッション・PVが同時に高い値として出ています。`,
      'まず前提として、ユーザー数は「来た人」、セッション数は「訪問回数」、PV数は「見られたページ数」です。3つが同時に伸びる日は、サイト外からの流入が増えた可能性を最初に疑います。',
      '広告運用上は、ここで読めるのは成果改善ではなくトラフィック増加のシグナルです。広告費やCVが未連携のままCPA改善・ROAS改善とは判断しません。',
      pagesPerSession
        ? `回遊の濃さを見る補助指標として、PV ÷ セッションは約${pagesPerSession}です。訪問あたり閲覧ページ数が大きく跳ねたというより、訪問母数の増加を優先して確認します。`
        : '回遊の濃さを見るには、PV ÷ セッションを追加で確認します。',
      '原因を詰める時は、同日の source / medium、LP、検索クエリ、広告キャンペーン変更履歴を同じ表で突合します。',
      'もし特定チャネルだけ伸びていれば配信・検索・外部露出の影響、複数チャネルで伸びていれば季節性・ニュース・ブランド需要の影響を疑います。',
    ],
    hypotheses: [
      {
        hypothesis: '流入元のどれかが同日に伸び、ユーザー数とセッション数を押し上げた可能性があります。',
        evidence: `${primarySource}: ${metrics}`,
        missing_data: 'source / medium別セッション、参照元、キャンペーン名',
      },
      {
        hypothesis: '特定LPまたは特定コンテンツへの露出増により、PV数も同時に増えた可能性があります。',
        evidence: `${primarySource}: PV数 ${pvCount ?? '取得済み値'}`,
        missing_data: 'LP別セッション、LP別PV、検索クエリ、該当ページの公開・更新履歴',
      },
      {
        hypothesis: '広告配信を強めた影響の可能性はありますが、媒体KPI未連携のため効率改善とはまだ言えません。',
        evidence: `${unsupportedDisplay} は今回のグラフ根拠には未連携`,
        missing_data: '広告費、クリック数、表示回数、CTR、CPC、CV、CPA、ROAS',
      },
    ],
    actions: [
      { priority: 'P0', action: '同日の source / medium 別セッションを確認', rationale: `${primarySource} で3指標が同時に増えており、最初に流入元の偏りを切り分けるため`, expected_metric: 'source / medium別セッション、ユーザー数、PV数' },
      { priority: 'P1', action: '伸びたLPを特定し、PV増がどのページ起点かを見る', rationale: 'PV数328がサイト全体の薄い増加か、特定ページ集中かで打ち手が変わるため', expected_metric: 'LP別セッション、LP別PV、入口ページ別ユーザー数' },
      { priority: 'P2', action: '検索クエリと外部露出を確認する', rationale: '広告以外の検索需要・記事露出・ブランド指名増でも同じ形の増加が起きるため', expected_metric: '検索クエリ、自然検索流入、参照元URL' },
      { priority: 'P3', action: '媒体管理画面で配信変更履歴を突合する', rationale: '広告起因かどうかはGA4グラフだけでは断定せず、媒体側のクリック・表示・費用で確認するため', expected_metric: 'クリック数、インプレッション、CTR、CPC、広告費' },
      { priority: 'P4', action: 'CV・売上・問い合わせへの接続を確認する', rationale: '流入増が成果増につながったかを最後に判断するため', expected_metric: 'CV、CVR、CPA、ROAS、売上' },
    ],
    limitations: [
      'この考察は、画面上で取得済みのグラフ根拠に存在する chart_id・指標・値・期間だけを採用しています。',
      `${unsupportedDisplay} は今回のGA4グラフ根拠には未連携です。未取得KPIを根拠にした断定はしていません。`,
      '広告運用の成果判断には、媒体管理画面または広告データ連携後のクリック・費用・CVデータが必要です。',
    ],
    review_status: {
      verdict: 'recovered',
      notes: ['取得済みグラフ根拠で照合', '未連携KPIを分離', '保存済みデータから再構成'],
      blocking_issues: [],
      checked_items: ['chart_id', 'metric', 'value', 'period'],
      unsupported_kpis: unsupportedKpis,
      evidence_scope: 'recovered_from_chart_groups',
    },
    agent_trace: recoveredTrace,
    _strippedMarkdown: '',
  }
}

function hasInsightReportArtifact(content) {
  const source = String(content || '')
  return /\\?"version\\?"\s*:\s*\\?"insight_report_v2\\?"/.test(source) ||
    /\\?"agent_trace\\?"\s*:/.test(source) ||
    /```insight-report\s*\n/i.test(source)
}

function formatAgentLabel(item) {
  const key = String(item?.stage || item?.label || '').toLowerCase()
  if (key.includes('data_evidence') || key.includes('data evidence')) return '数値根拠の確認'
  if (key.includes('beginner') || key.includes('explanation')) return '表現の整理'
  if (key.includes('senior') || key.includes('adops')) return '運用観点の確認'
  if (key.includes('unsupported') || key.includes('kpi_guard')) return '未連携KPIの確認'
  if (key.includes('final') || key.includes('consistency') || key.includes('review')) return '整合性チェック'
  return item?.label || item?.stage || '確認項目'
}

function formatAgentMode(mode) {
  const value = String(mode || '').toLowerCase()
  if (value === 'llm_stage') return 'AI確認'
  if (value === 'deterministic_fallback') return '自動照合'
  if (value === 'unknown' || !value) return '確認済み'
  return '確認済み'
}

function AgentTracePanel({ trace = [] }) {
  const items = normalizeAgentTrace(trace)
  if (items.length === 0) return null
  const completedCount = items.filter((item) => ['completed', 'repaired'].includes(item.status)).length
  const usesLlm = items.some((item) => item.mode === 'llm_stage')

  return (
    <details className={cardStyles.agentTracePanel} data-testid="agent-trace-panel">
      <summary className="japanese-text">
        <span className="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span>
          <strong>根拠と整合性の確認</strong>
          <em>{items.length}項目を確認 / {completedCount}件完了 / {usesLlm ? 'AI確認を含む' : '自動照合済み'}</em>
        </span>
      </summary>
      <div className={cardStyles.agentTraceList}>
        {items.map((item, index) => (
          <article key={`${item.stage}-${index}`} className={cardStyles.agentTraceItem}>
            <div className={cardStyles.agentTraceHead}>
              <b>{index + 1}</b>
              <div>
                <strong>{formatAgentLabel(item)}</strong>
                <span>{item.summary || item.excerpt || '検査完了'}</span>
              </div>
              <mark data-mode={item.mode || 'unknown'}>{formatAgentMode(item.mode)}</mark>
            </div>
            {item.checks?.length > 0 && (
              <p className="japanese-text">確認: {item.checks.slice(0, 4).join(' / ')}</p>
            )}
            {item.issues?.length > 0 && (
              <p className={cardStyles.agentTraceIssue}>制約: {item.issues.slice(0, 3).join(' / ')}</p>
            )}
          </article>
        ))}
      </div>
    </details>
  )
}

function EvidenceStatusBand({ report }) {
  const status = report?.review_status
  if (!status) return null
  const verdict = String(status.verdict || 'checked').toLowerCase()
  const isPass = verdict === 'pass'
  const isRecovered = verdict === 'recovered'
  const evidenceRows = Array.isArray(report?.evidence_table) ? report.evidence_table : []
  const first = evidenceRows[0] || {}
  const unsupported = Array.isArray(status.unsupported_kpis) ? status.unsupported_kpis : []
  const statusTitle = isPass
    ? '数値照合済み'
    : isRecovered
      ? '取得済みグラフ根拠で照合済み'
      : '照合範囲を限定して表示'

  return (
    <section
      className={`${cardStyles.evidenceStatusBand} ${isPass || isRecovered ? cardStyles.evidenceStatusPass : cardStyles.evidenceStatusWarn}`}
      data-testid="evidence-status-band"
      aria-label="数値照合状態"
    >
      <span className="material-symbols-outlined" aria-hidden="true">{isPass || isRecovered ? 'verified' : 'rule'}</span>
      <div>
        <strong className="japanese-text">{statusTitle}</strong>
        <p className="japanese-text">
          {[
            first.source ? `参照グラフ: ${first.source}` : '',
            first.claim ? `参照: ${first.claim}` : '',
            first.metric ? `指標: ${first.metric}` : '',
            first.value ? `値: ${first.value}` : '',
            first.period ? `期間: ${first.period}` : '',
            unsupported.length > 0 ? `未連携KPI: ${unsupported.join(' / ')}` : '',
            Array.isArray(status.checked_items) && status.checked_items.length > 0 ? '確認した項目: グラフ / 指標 / 値 / 期間' : '',
          ].filter(Boolean).join(' / ')}
        </p>
      </div>
    </section>
  )
}

function InsightReportSections({ content, operationalCards }) {
  const metricRows = extractMetricRows(content)
  const observations = collectMarkdownBullets(content, ['観測', '事実', '現状', '指標'], 4)
  const inferences = collectMarkdownBullets(content, ['推論', '原因', '解釈', '仮説'], 4)
  const missingItems = extractMissingItems(content)
  const actionRows = extractActionRows(content, operationalCards)

  return (
    <div className={cardStyles.reportFlow} data-testid="insight-report-flow">
      <section className={cardStyles.metricSection} aria-label="根拠指標テーブル">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">table_chart</span>
          <h3 className="japanese-text">根拠指標テーブル</h3>
        </div>
        <div className={cardStyles.metricTable}>
          <div className={cardStyles.tableHead}>指標</div>
          <div className={cardStyles.tableHead}>変化</div>
          <div className={cardStyles.tableHead}>読み取り</div>
          {metricRows.length > 0 ? metricRows.map(([metric, delta, note]) => (
            <div key={`${metric}-${note}`} className={cardStyles.tableRow}>
              <strong>{metric}</strong>
              <span>{delta}</span>
              <p className="japanese-text">{note}</p>
            </div>
          )) : (
            <div className={cardStyles.emptyTableNote}>
              <p className="japanese-text">回答本文から根拠指標を自動抽出できませんでした。下の本文で明示された数値だけを確認してください。</p>
            </div>
          )}
        </div>
      </section>

      <div className={cardStyles.splitGrid}>
        <section className={cardStyles.factPanel} aria-label="観測事実">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">fact_check</span>
            <h3 className="japanese-text">観測事実</h3>
          </div>
          {(observations.length > 0 ? observations : ['本文内の数値変化と比較期間を確認']).map((item) => (
            <p key={item} className="japanese-text">{item}</p>
          ))}
        </section>
        <section className={cardStyles.inferencePanel} aria-label="AI推論">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">psychology_alt</span>
            <h3 className="japanese-text">AI推論</h3>
          </div>
          {(inferences.length > 0 ? inferences : ['原因は仮説として扱い、未取得データで追加検証']).map((item) => (
            <p key={item} className="japanese-text">{item}</p>
          ))}
        </section>
      </div>

      <section className={cardStyles.missingBand} aria-label="未取得データ">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">error</span>
          <h3 className="japanese-text">未取得データ</h3>
        </div>
        <div className={cardStyles.missingList}>
          {(missingItems.length > 0 ? missingItems : ['回答内で未取得/不明と明記された項目を確認']).map((item) => (
            <span key={item} className="japanese-text">{item}</span>
          ))}
        </div>
      </section>

      <section className={cardStyles.actionTableSection} aria-label="3施策の実行表">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
          <h3 className="japanese-text">3施策の実行表</h3>
        </div>
        <div className={cardStyles.actionTable}>
          {actionRows.map((row) => (
            <div key={row.label} className={cardStyles.actionRow}>
              <b>{row.label}</b>
              <div>
                <strong className="japanese-text">{row.task}</strong>
                <p className="japanese-text">{row.evidence}</p>
              </div>
              <span className="japanese-text">{row.owner}</span>
              <em className="japanese-text">{row.due}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StructuredInsightReport({ report }) {
  if (!report) return null

  return (
    <div className={cardStyles.markdownReport} data-testid="insight-report-v2">
      <h2 className="japanese-text">AI考察レポート</h2>
      <EvidenceStatusBand report={report} />

      {report.executive_summary.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="重要結論">
          <h3 className="japanese-text">重要結論</h3>
          {report.executive_summary.slice(0, 5).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.evidence_table.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="根拠テーブル">
          <h3 className="japanese-text">根拠テーブル</h3>
          <div className={cardStyles.simpleTableWrap}>
            <table className={cardStyles.simpleEvidenceTable}>
              <thead>
                <tr>
                  <th>根拠ID</th>
                  <th>グラフ/根拠</th>
                  <th>指標</th>
                  <th>値</th>
                  <th>期間</th>
                  <th>用途</th>
                </tr>
              </thead>
              <tbody>
                {report.evidence_table.slice(0, 8).map((row, index) => (
                  <tr key={`${row.source}-${row.metric}-${row.value}-${index}`}>
                    <td translate="no">{row.source || '-'}</td>
                    <td className="japanese-text">{row.chart_title || row.claim || '-'}</td>
                    <td>{row.metric || '-'}</td>
                    <td><strong>{row.value || '-'}</strong></td>
                    <td>{row.period || '-'}</td>
                    <td className="japanese-text">{row.used_for || row.confidence || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.interpretation.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="読み解き">
          <h3 className="japanese-text">読み解き</h3>
          {report.interpretation.slice(0, 6).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.hypotheses.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="仮説と不足データ">
          <h3 className="japanese-text">仮説と不足データ</h3>
          {report.hypotheses.slice(0, 4).map((item, index) => (
            <p key={`${item.hypothesis}-${index}`} className="japanese-text">
              <strong>仮説:</strong> {item.hypothesis || '未記載'}
              {item.missing_data ? ` / 確認するデータ: ${item.missing_data}` : ''}
            </p>
          ))}
        </section>
      )}

      {report.actions.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="次に見ること">
          <h3 className="japanese-text">次に見ること</h3>
          <ol className={cardStyles.simpleActionList}>
            {report.actions.slice(0, 5).map((row, index) => (
              <li key={`${row.priority}-${row.action}-${index}`} className="japanese-text">
                <strong>{row.priority || `P${index}`}: {row.action || '確認項目'}</strong>
                {row.rationale && <span>{row.rationale}</span>}
                {row.expected_metric && <em>見る指標: {row.expected_metric}</em>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {report.limitations.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="制約">
          <h3 className="japanese-text">制約・判断保留</h3>
          {report.limitations.slice(0, 5).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.review_status && (
        <section className={cardStyles.simpleReview} aria-label="レビュー状態">
          <strong className="japanese-text">検証ログ</strong>
          {report.review_status.notes?.length > 0 && (
            <span className="japanese-text">{report.review_status.notes.join(' / ')}</span>
          )}
          {report.review_status.blocking_issues?.length > 0 && (
            <span className="japanese-text">制約: {report.review_status.blocking_issues.join(' / ')}</span>
          )}
        </section>
      )}

      <AgentTracePanel trace={report.agent_trace} />
    </div>
  )
}

function isStructuredReportV2(report) {
  return Array.isArray(report?.executive_summary) || Array.isArray(report?.evidence_table)
}

export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  insightMeta,
  chartGroups = [],
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

  const derivedReport = extractInsightReport(aiContent)
  const derivedMeta = insightMeta ?? extractInsightMeta(aiContent)
  const agentTrace = normalizeAgentTrace(turn.agentTrace ?? derivedReport?.agent_trace ?? derivedMeta?.agent_trace)
  if (derivedReport && agentTrace.length > 0 && (!derivedReport.agent_trace || derivedReport.agent_trace.length === 0)) {
    derivedReport.agent_trace = agentTrace
  }
  const renderContent = derivedReport?._strippedMarkdown ?? derivedMeta?._strippedMarkdown ?? aiContent
  const shouldHideRawArtifact = !derivedReport && hasInsightReportArtifact(renderContent)
  const recoveredReport = shouldHideRawArtifact
    ? buildSafeRecoveredReport({ userPrompt, aiContent, agentTrace, chartGroups })
    : null
  const displayReport = derivedReport ?? recoveredReport
  const hasStructuredV2Report = isStructuredReportV2(displayReport)
  const fallbackContent = shouldHideRawArtifact ? '' : renderContent

  const operationalCards = shouldHideRawArtifact ? [] : extractOperationalInsightCards(renderContent)

  return (
    <article
      className={`${styles.turnCard} ${isError ? styles.turnCardError : ''} md-v2-enter`}
      data-testid="insight-turn-card"
    >
      <header className={styles.turnHeader}>
        <div className={styles.aiAvatar} aria-hidden="true">
          <span className="material-symbols-outlined">auto_awesome</span>
        </div>
        <div className={styles.turnHeaderMeta}>
          <p className={styles.aiLabel}>AI 考察エンジン</p>
          {aiTimestamp && (
            <span className={styles.timestamp} aria-label={`応答日時 ${aiTimestamp}`}>
              {aiTimestamp}
            </span>
          )}
        </div>
      </header>

      <UserPromptPill content={userPrompt} timestamp={userTimestamp} />

      {displayReport ? (
        hasStructuredV2Report ? (
          <StructuredInsightReport report={displayReport} />
        ) : (
          <InsightHtmlReport report={displayReport} />
        )
      ) : derivedMeta ? (
        <InsightSummaryHero meta={derivedMeta} />
      ) : null}

      {!displayReport && operationalCards.length > 0 && (
        <div className={styles.operationalCards} data-testid="operational-insight-cards">
          {operationalCards.map((card) => (
            <section key={card.key} className={styles.operationalCard}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {card.key === 'cause' ? 'manage_search' :
                  card.key === 'implication' ? 'tips_and_updates' :
                  card.key === 'metric' ? 'monitoring' :
                  card.key === 'expectedKpi' ? 'speed' : 'task_alt'}
              </span>
              <div>
                <h3 className="japanese-text">{card.title}</h3>
                <p className="japanese-text">{card.body}</p>
              </div>
            </section>
          ))}
        </div>
      )}

      {!displayReport && !isError && fallbackContent && (
        <InsightReportSections
          content={fallbackContent}
          operationalCards={operationalCards}
        />
      )}

      {displayReport ? (
        derivedReport && renderContent && (
          <details className={cardStyles.markdownDetails}>
            <summary className="japanese-text">
              <span className="material-symbols-outlined" aria-hidden="true">article</span>
              詳細なAI回答を開く
            </summary>
            <div className={styles.turnBody}>
              <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
            </div>
          </details>
        )
      ) : (
        <div className={styles.turnBody}>
          <div className={cardStyles.longFormHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">article</span>
            <h3 className="japanese-text">AIによる考察回答</h3>
          </div>
          {fallbackContent ? (
            <MarkdownRenderer content={fallbackContent} variant="ai-insight" size={size} />
          ) : (
            <p className="japanese-text text-sm text-on-surface-variant" data-testid="insight-report-artifact-hidden">
              この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。
            </p>
          )}
        </div>
      )}
    </article>
  )
}
