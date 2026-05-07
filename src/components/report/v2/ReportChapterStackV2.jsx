import { useMemo } from 'react'
import { buildReportDecisionInsights } from '../../../utils/reportDecisionInsights'
import styles from './ReportChapterStackV2.module.css'

const TIER_LABELS = {
  direct: '直接競合',
  adjacent: '隣接競合',
  reference: '参考',
  out_of_scope: '対象外',
}

const COMPARE_LABELS = {
  compare: {
    eyebrow: 'Compare Flow',
    title: '比較レポートの読み順',
    lead: '長文本文の前に、結論・比較軸・根拠・実行順・計測条件を並べて確認します。',
    chapters: ['結論', '比較マトリクス', '根拠トレース', '実行プラン', '計測条件', 'Markdown本文'],
  },
  discovery: {
    eyebrow: 'Discovery Flow',
    title: '発見レポートの読み順',
    lead: '市場定義から候補分類、採用/除外理由、不足根拠、再検索条件までを本文前に確認します。',
    chapters: ['市場定義', '分類レーン', '比較候補', '採用/除外理由', '不足根拠', '再検索条件'],
  },
}

function cleanText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDomain(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw) && !raw.includes('.')) return raw
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
  }
}

function getReportExcerpt(reportMd) {
  if (!reportMd) return ''
  const lines = reportMd
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim()
      if (!text) return false
      if (/^#{1,6}\s+/.test(text)) return false
      if (/^\|?[-:\s|]+\|?$/.test(text)) return false
      if (/^(実行メタデータ|Execution Metadata)/i.test(text)) return false
      return true
    })
    .slice(0, 16)
  return lines.join('\n')
}

function compactValue(...values) {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function extractAfterLabel(reportMd, labels) {
  if (!reportMd) return ''
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = reportMd.match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n]+)`, 'i'))
    if (match?.[1]) return cleanText(match[1])
  }
  return ''
}

function makeSourceLabel(item) {
  return compactValue(item.observation, item.sourceUrl, item.level?.helper, '本文からの抽出根拠')
}

function buildMarketDefinition(envelope, reportMd) {
  return {
    market: compactValue(
      envelope?.market_definition,
      envelope?.market?.definition,
      envelope?.target_market,
      extractAfterLabel(reportMd, ['市場定義', 'ターゲット市場', '対象市場']),
      '自社LPの訴求・検索意図・商材カテゴリから推定した比較市場',
    ),
    audience: compactValue(
      envelope?.target_audience,
      envelope?.market?.audience,
      extractAfterLabel(reportMd, ['対象顧客', 'ターゲット', '想定顧客']),
      '広告流入後に資料請求・問い合わせ・購入を検討する見込み客',
    ),
    query: compactValue(
      envelope?.query_used,
      envelope?.search_query,
      envelope?.discovery?.query_used,
      extractAfterLabel(reportMd, ['検索クエリ', '再検索条件', '検索条件']),
      '商材名、課題語、比較/導入/料金などの購買検討語',
    ),
  }
}

function MeasurementConditions({ envelope, reportMd, insights }) {
  const conditions = [
    ['比較対象', `${Math.max(insights.brands.length, insights.tiers.examples.length)}件 / 対象外 ${insights.tiers.counts.out_of_scope || 0}件`],
    ['根拠状態', `確認済み ${insights.evidence.confirmed} / 評価保留 ${insights.evidence.pending}`],
    ['期待KPI', `計測対象: ${insights.topAction?.expectedKpi || extractAfterLabel(reportMd, ['期待KPI', 'KPI']) || 'CVR / CPA への影響を実測で確認'}`],
    ['分析条件', compactValue(envelope?.model, envelope?.analysis_model, envelope?.provider, 'Markdown本文と取得済みページ情報を利用')],
  ]

  return (
    <section className={styles.chapter} aria-labelledby="compare-measurement-title">
      <div className={styles.chapterHead}>
        <span>05</span>
        <div>
          <h3 id="compare-measurement-title">計測条件を固定</h3>
          <p>比較判断を施策化する前に、何を同じ条件で見たかを揃えます。</p>
        </div>
      </div>
      <div className={styles.conditionGrid}>
        {conditions.map(([label, value]) => (
          <div key={label} className={styles.conditionItem}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function EvidenceTrace({ insights }) {
  const rows = insights.evidenceItems.length > 0
    ? insights.evidenceItems
    : [{ label: 'Markdown本文', observation: '構造化根拠がないため、本文の説明を確認してください。', level: insights.evidence.confidence }]

  return (
    <section className={styles.chapter} aria-labelledby="compare-evidence-title">
      <div className={styles.chapterHead}>
        <span>03</span>
        <div>
          <h3 id="compare-evidence-title">根拠トレース</h3>
          <p>観測事実、AI推論、未確認情報を混ぜずに読み分けます。</p>
        </div>
      </div>
      <div className={styles.traceList}>
        {rows.slice(0, 6).map((item, idx) => (
          <article key={`${item.label}-${idx}`} className={styles.traceItem}>
            <span className="material-symbols-outlined" aria-hidden="true">{item.level?.icon || 'fact_check'}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{makeSourceLabel(item)}</small>
            </div>
            <TierBadge role={{ key: item.level?.key === 'pending' ? 'reference' : 'direct', label: item.level?.label || '根拠' }} />
          </article>
        ))}
      </div>
    </section>
  )
}

function CompareMatrix({ insights }) {
  const brands = insights.brands.length > 0
    ? insights.brands
    : insights.tiers.examples.map((item) => ({ brand: item.brand, role: item.role, reason: item.reason, x: 50, y: 50, pendingCount: 0 }))
  const axes = [
    ['CTA', 'CVに向かう主導線'],
    ['オファー', '価格・特典・資料請求の強さ'],
    ['信頼要素', '実績・導入事例・第三者情報'],
    ['ファネル段階', '認知から比較検討までの接続'],
  ]

  return (
    <section className={styles.chapter} aria-labelledby="compare-matrix-title">
      <div className={styles.chapterHead}>
        <span>02</span>
        <div>
          <h3 id="compare-matrix-title">比較マトリクス</h3>
          <p>自社と競合を同じ比較軸で横並びにし、勝ち筋と不足根拠を分けます。</p>
        </div>
      </div>
      <div className={styles.matrixWrap}>
        <table className={styles.compareMatrix}>
          <thead>
            <tr>
              <th>比較軸</th>
              {brands.slice(0, 3).map((brand, idx) => (
                <th key={`${brand.brand}-${idx}`}>
                  <span>{idx === 0 ? '自社/基準' : `競合${idx}`}</span>
                  {getDomain(brand.brand) || brand.brand}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axes.map(([axis, helper], axisIdx) => (
              <tr key={axis}>
                <th>
                  <strong>{axis}</strong>
                  <small>{helper}</small>
                </th>
                {brands.slice(0, 3).map((brand, brandIdx) => {
                  const observed = brand.confirmedCount > brand.pendingCount
                  const score = axisIdx % 2 === 0 ? brand.x : brand.y
                  return (
                    <td key={`${brand.brand}-${axis}`}>
                      <span className={observed ? styles.factChip : styles.inferenceChip}>
                        {observed ? '観測事実' : brand.pendingCount > 0 ? '未確認' : 'AI推論'}
                      </span>
                      <p>{score >= 64 ? '強みとして活用' : score <= 38 ? '改善余地あり' : brandIdx === 0 ? '基準化して比較' : '同等水準'}</p>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MarketDefinition({ envelope, reportMd }) {
  const market = buildMarketDefinition(envelope, reportMd)
  return (
    <section className={styles.chapter} aria-labelledby="discovery-market-title">
      <div className={styles.chapterHead}>
        <span>01</span>
        <div>
          <h3 id="discovery-market-title">市場定義</h3>
          <p>候補URLを分類する前に、どの市場・顧客・検索条件で探したかを固定します。</p>
        </div>
      </div>
      <div className={styles.definitionGrid}>
        <div><span>対象市場</span><strong>{market.market}</strong></div>
        <div><span>想定顧客</span><strong>{market.audience}</strong></div>
        <div><span>検索/再検索条件</span><strong>{market.query}</strong></div>
      </div>
    </section>
  )
}

function HandoffCandidates({ insights }) {
  const rows = insights.tiers.examples.filter((item) => item.role.key === 'direct' || item.role.key === 'adjacent')
  const fallbackRows = rows.length > 0 ? rows : insights.tiers.examples
  return (
    <section className={styles.chapter} aria-labelledby="discovery-handoff-title">
      <div className={styles.chapterHead}>
        <span>03</span>
        <div>
          <h3 id="discovery-handoff-title">次に比較する候補</h3>
          <p>Compareへ送る前提で、直接競合と隣接競合を優先順に並べます。</p>
        </div>
      </div>
      <div className={styles.handoffList}>
        {fallbackRows.slice(0, 5).map((item, idx) => (
          <article key={`${item.brand}-${idx}`} className={styles.handoffItem}>
            <span>{String(idx + 1).padStart(2, '0')}</span>
            <div>
              <strong>{getDomain(item.brand) || item.brand || `候補 ${idx + 1}`}</strong>
              <small>{item.reason || '市場・訴求・CV導線が比較可能な候補として扱います。'}</small>
            </div>
            <TierBadge role={item.role} />
          </article>
        ))}
      </div>
    </section>
  )
}

function ReasonAndGapBoard({ insights }) {
  const accepted = insights.tiers.examples.filter((item) => item.role.key === 'direct' || item.role.key === 'adjacent')
  const rejected = insights.tiers.examples.filter((item) => item.role.key === 'reference' || item.role.key === 'out_of_scope')
  const gaps = insights.evidenceItems.filter((item) => item.level?.key === 'pending')
  const fallbackGaps = gaps.length > 0 ? gaps : [
    { label: '価格・実績・CVRなどの定量情報', observation: '公開ページだけでは不足しやすいため、比較前に追加確認します。' },
    { label: '検索意図との一致度', observation: '候補が広い場合は、購買検討語で再検索します。' },
  ]

  return (
    <section className={styles.chapter} aria-labelledby="discovery-reasons-title">
      <div className={styles.chapterHead}>
        <span>04</span>
        <div>
          <h3 id="discovery-reasons-title">採用/除外理由と不足根拠</h3>
          <p>採用理由、除外理由、未取得データを同じ場所で確認します。</p>
        </div>
      </div>
      <div className={styles.reasonGrid}>
        <div className={styles.reasonColumn}>
          <h4>採用理由</h4>
          {(accepted.length ? accepted : insights.tiers.examples).slice(0, 3).map((item, idx) => (
            <p key={`${item.brand}-accepted-${idx}`}>確認 {idx + 1}: {item.reason || `${getDomain(item.brand) || item.brand} は比較候補として残します。`}</p>
          ))}
        </div>
        <div className={styles.reasonColumn}>
          <h4>除外理由</h4>
          {(rejected.length ? rejected : [{ brand: '未分類候補', reason: '対象外候補がない場合も、検索ツール/大手モール/メディア系は除外対象として再確認します。' }]).slice(0, 3).map((item, idx) => (
            <p key={`${item.brand}-rejected-${idx}`}>除外 {idx + 1}: {item.reason || `${getDomain(item.brand) || item.brand} は主比較から外します。`}</p>
          ))}
        </div>
        <div className={styles.reasonColumn}>
          <h4>不足根拠</h4>
          {fallbackGaps.slice(0, 3).map((item, idx) => (
            <p key={`${item.label}-gap-${idx}`}>不足 {idx + 1}: {item.label} - {item.observation || '追加確認が必要です。'}</p>
          ))}
        </div>
      </div>
    </section>
  )
}

function ResearchConditions({ envelope, reportMd, insights }) {
  const market = buildMarketDefinition(envelope, reportMd)
  const retryRows = [
    ['再検索語', market.query],
    ['残す候補', `直接競合 ${insights.tiers.counts.direct || 0} / 隣接 ${insights.tiers.counts.adjacent || 0}`],
    ['除外条件', '検索エンジン結果、大手モール、メディア/代理店/ツール紹介のみのページ'],
    ['追加取得', '料金、導入実績、CTA文言、フォーム到達、CV導線の定量情報'],
  ]
  return (
    <section className={styles.chapter} aria-labelledby="discovery-research-title">
      <div className={styles.chapterHead}>
        <span>05</span>
        <div>
          <h3 id="discovery-research-title">再検索条件</h3>
          <p>候補が弱い場合に、次回検索で変える条件を明示します。</p>
        </div>
      </div>
      <div className={styles.conditionGrid}>
        {retryRows.map(([label, value]) => (
          <div key={label} className={styles.conditionItem}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function meterValue(action, fallback) {
  const impact = Number(action?.impact)
  if (Number.isFinite(impact)) return Math.max(8, Math.min(100, impact))
  return fallback
}

function confidenceValue(confidence) {
  if (confidence?.key === 'high') return 88
  if (confidence?.key === 'low') return 36
  if (confidence?.key === 'pending') return 28
  return 62
}

function ChapterNav({ labels }) {
  return (
    <div className={styles.chapterNav} aria-label="レポートの読み順">
      {labels.map((label, idx) => (
        <span key={label} className={styles.chapterPill}>
          <strong>{String(idx + 1).padStart(2, '0')}</strong>
          {label}
        </span>
      ))}
    </div>
  )
}

function TierBadge({ role }) {
  const key = role?.key || 'direct'
  return (
    <span className={`${styles.tierBadge} ${styles[`tier_${key}`] || ''}`}>
      {TIER_LABELS[key] || role?.label || '比較対象'}
    </span>
  )
}

function CompareScope({ insights }) {
  const rows = insights.tiers.examples.length > 0
    ? insights.tiers.examples
    : insights.brands.map((brand) => ({ brand: brand.brand, role: brand.role, reason: brand.reason }))

  return (
    <section className={styles.chapter} aria-labelledby="compare-scope-title">
      <div className={styles.chapterHead}>
        <span>01</span>
        <div>
          <h3 id="compare-scope-title">比較対象を先に確認</h3>
          <p>自社LPと比較URLを分け、対象外や参考サイトは判断材料として扱います。</p>
        </div>
      </div>
      <div className={styles.scopeGrid}>
        <div className={styles.ownedLp}>
          <span className="material-symbols-outlined" aria-hidden="true">home_pin</span>
          <div>
            <strong>自社LP</strong>
            <small>入力URLの訴求・導線・信頼要素を基準化</small>
          </div>
        </div>
        <div className={styles.targetList}>
          {rows.slice(0, 6).map((item, idx) => (
            <article key={`${item.brand}-${idx}`} className={styles.targetItem}>
              <div>
                <strong>{cleanText(item.brand) || `競合URL ${idx + 1}`}</strong>
                {item.reason && <small>{item.reason}</small>}
              </div>
              <TierBadge role={item.role} />
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function DiscoveryFoundSet({ insights }) {
  const rows = insights.tiers.examples
  const counts = insights.tiers.counts
  return (
    <section className={styles.chapter} aria-labelledby="discovery-found-title">
      <div className={styles.chapterHead}>
        <span>01</span>
        <div>
          <h3 id="discovery-found-title">見つかったURLを分類</h3>
          <p>直接競合・隣接・参考・対象外を分け、主比較には直接/隣接だけを残します。</p>
        </div>
      </div>
      <div className={styles.tierCountGrid}>
        {[
          ['direct', '直接競合'],
          ['adjacent', '隣接競合'],
          ['reference', '参考'],
          ['out_of_scope', '対象外'],
        ].map(([key, label]) => (
          <div key={key} className={`${styles.tierCount} ${styles[`tierCount_${key}`] || ''}`}>
            <strong>{counts[key] || 0}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.foundList}>
        {rows.slice(0, 7).map((item, idx) => (
          <article key={`${item.brand}-${idx}`} className={styles.foundItem}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.role.key === 'out_of_scope' ? 'block' : item.role.key === 'reference' ? 'visibility' : 'adjust'}
            </span>
            <div>
              <strong>{getDomain(item.brand) || item.brand || `候補 ${idx + 1}`}</strong>
              {item.reason && <small>{item.reason}</small>}
            </div>
            <TierBadge role={item.role} />
          </article>
        ))}
      </div>
    </section>
  )
}

function ComparisonBars({ insights, kind }) {
  const comparisonBrands = insights.brands.slice(0, 5)
  const actions = insights.actions.length > 0 ? insights.actions : [insights.topAction].filter(Boolean)
  return (
    <section className={styles.chapter} aria-labelledby={`${kind}-bars-title`} data-testid={`${kind}-comparison-bars`}>
      <div className={styles.chapterHead}>
        <span>02</span>
        <div>
          <h3 id={`${kind}-bars-title`}>{kind === 'discovery' ? '自社LPと競合の差を見る' : '文章の要点をグラフ化'}</h3>
          <p>{kind === 'discovery' ? '発見した競合と比べ、獲得導線と信頼要素のどちらが弱いかを先に掴みます。' : 'レポート本文の施策を Impact / Confidence で並べ替えて読みます。'}</p>
        </div>
      </div>
      <div className={styles.graphSplit}>
        <div className={styles.barCard}>
          <div className={styles.graphTitle}>施策優先度</div>
          {actions.slice(0, 4).map((action, idx) => (
            <div key={`${action.title}-${idx}`} className={styles.barRow}>
              <div className={styles.barLabel}>
                <span>{action.ownerArea || 'LP改善'}</span>
                <strong>{action.title}</strong>
              </div>
              <div className={styles.barTrack} aria-label={`${action.title} impact ${meterValue(action, 70)}%`}>
                <i style={{ width: `${meterValue(action, 72 - idx * 8)}%` }} />
              </div>
              <small>{confidenceValue(action.confidence)}%</small>
            </div>
          ))}
        </div>
        <div className={styles.barCard}>
          <div className={styles.graphTitle}>{kind === 'discovery' ? '主比較に残す候補' : '比較URLの状態'}</div>
          {comparisonBrands.length > 0 ? comparisonBrands.map((brand, idx) => (
            <div key={`${brand.brand}-${idx}`} className={styles.brandMetric}>
              <div>
                <strong>{brand.brand}</strong>
                <span>{brand.role?.label || '比較対象'} / 保留 {brand.pendingCount ?? 0}</span>
              </div>
              <div className={styles.dualBars} aria-hidden="true">
                <i style={{ width: `${brand.x || 50}%` }} />
                <b style={{ width: `${brand.y || 50}%` }} />
              </div>
            </div>
          )) : (
            <p className={styles.emptyNote}>比較軸が見つからない場合は、Markdown本文の評価表を参照してください。</p>
          )}
        </div>
      </div>
    </section>
  )
}

function PositionSketch({ insights }) {
  const brands = insights.brands.slice(0, 6)
  return (
    <section className={styles.chapter} aria-labelledby="discovery-position-title">
      <div className={styles.chapterHead}>
        <span>03</span>
        <div>
          <h3 id="discovery-position-title">Position Mapで位置関係を確認</h3>
          <p>対象外を除き、獲得導線と信頼訴求の2軸で自社LPの改善方向を見ます。</p>
        </div>
      </div>
      <div className={styles.positionBox} aria-label="競合ポジション概略">
        <span className={styles.axisX}>獲得導線</span>
        <span className={styles.axisY}>信頼訴求</span>
        {brands.map((brand, idx) => (
          <span
            key={`${brand.brand}-${idx}`}
            className={`${styles.plot} ${styles[`plot_${brand.role?.key || 'direct'}`] || ''}`}
            style={{ left: `${brand.x || 50}%`, bottom: `${brand.y || 50}%` }}
            title={brand.brand}
          >
            {idx + 1}
          </span>
        ))}
      </div>
      <div className={styles.legend}>
        {brands.map((brand, idx) => (
          <span key={`${brand.brand}-legend-${idx}`}>
            <i>{idx + 1}</i>{brand.brand}
          </span>
        ))}
      </div>
    </section>
  )
}

function MarkdownChapter({ reportMd, insights, kind }) {
  const excerpt = getReportExcerpt(reportMd)
  return (
    <section className={styles.chapter} aria-labelledby={`${kind}-markdown-title`}>
      <div className={styles.chapterHead}>
        <span>06</span>
        <div>
          <h3 id={`${kind}-markdown-title`}>Markdownで読める説明</h3>
          <p>グラフで方向を掴んだ後、判断理由と補足を文章で確認します。</p>
        </div>
      </div>
      <div className={styles.markdownPanel}>
        {excerpt ? <div className={styles.markdownExcerpt}>{excerpt}</div> : (
          <p className={styles.emptyNote}>Markdown本文はレポート下部に表示されます。</p>
        )}
      </div>
      <div className={styles.evidenceStrip}>
        {insights.evidenceItems.slice(0, 4).map((item, idx) => (
          <span key={`${item.label}-${idx}`}>
            <i className="material-symbols-outlined" aria-hidden="true">{item.level.icon}</i>
            {item.label}
          </span>
        ))}
      </div>
    </section>
  )
}

function ActionChapter({ insights }) {
  const actions = insights.actions.length > 0 ? insights.actions : [insights.topAction].filter(Boolean)
  return (
    <section className={styles.chapter} aria-labelledby="compare-actions-title">
      <div className={styles.chapterHead}>
        <span>04</span>
        <div>
          <h3 id="compare-actions-title">次にやることへ落とす</h3>
          <p>担当領域・期待KPI・初回タスクに分解し、広告運用の作業へ移せる状態にします。</p>
        </div>
      </div>
      <div className={styles.actionGrid}>
        {actions.slice(0, 4).map((action, idx) => (
          <article key={`${action.title}-${idx}`} className={styles.actionCard}>
            <span>{String(idx + 1).padStart(2, '0')}</span>
            <h4>{action.title}</h4>
            <dl>
              <div><dt>担当</dt><dd>{action.ownerArea}</dd></div>
              <div><dt>期待KPI</dt><dd>{action.expectedKpi}</dd></div>
              <div><dt>初回タスク</dt><dd>{action.firstStep}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function ReportChapterStackV2({ envelope, reportMd, kind = 'compare' }) {
  const insights = useMemo(
    () => buildReportDecisionInsights({ envelope, reportMd }),
    [envelope, reportMd],
  )
  const mode = kind === 'discovery' ? 'discovery' : 'compare'
  const copy = COMPARE_LABELS[mode]

  if (!reportMd && !insights.actions.length && !insights.brands.length && !insights.tiers.examples.length) {
    return null
  }

  return (
    <section className={styles.stack} aria-labelledby={`report-chapter-stack-${mode}`}>
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h2 id={`report-chapter-stack-${mode}`}>{copy.title}</h2>
          <p>{copy.lead}</p>
        </div>
        <ChapterNav labels={copy.chapters} />
      </div>

      {mode === 'discovery' ? (
        <>
          <MarketDefinition envelope={envelope} reportMd={reportMd} />
          <DiscoveryFoundSet insights={insights} />
          <HandoffCandidates insights={insights} />
          <ComparisonBars insights={insights} kind="discovery" />
          <ReasonAndGapBoard insights={insights} />
          <ResearchConditions envelope={envelope} reportMd={reportMd} insights={insights} />
          <MarkdownChapter reportMd={reportMd} insights={insights} kind="discovery" />
        </>
      ) : (
        <>
          <CompareScope insights={insights} />
          <CompareMatrix insights={insights} />
          <ComparisonBars insights={insights} kind="compare" />
          <EvidenceTrace insights={insights} />
          <ActionChapter insights={insights} />
          <MeasurementConditions envelope={envelope} reportMd={reportMd} insights={insights} />
          <MarkdownChapter reportMd={reportMd} insights={insights} kind="compare" />
        </>
      )}
    </section>
  )
}
