import { useMemo } from 'react'
import MarkdownRenderer from '../../MarkdownRenderer'
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
    eyebrow: 'Compare Report Flow',
    title: '比較レポートの読み順',
    lead: '入力した自社LPと競合URLを、文章レポートとグラフ根拠に分けて確認します。',
    chapters: ['比較対象', 'Markdownレポート', 'グラフ根拠', '次アクション'],
  },
  discovery: {
    eyebrow: 'Discovery Report Flow',
    title: '発見レポートの読み順',
    lead: '見つかった競合URLを分類し、自社LPと比較してどこを直すべきかまで確認します。',
    chapters: ['発見URL', '自社LP比較', 'ポジション', 'Markdownレポート'],
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
      if (/^\|?[-:\s|]+\|?$/.test(text)) return false
      if (/^(実行メタデータ|Execution Metadata)/i.test(text)) return false
      return true
    })
    .slice(0, 16)
  return lines.join('\n')
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
        <span>{kind === 'discovery' ? '04' : '03'}</span>
        <div>
          <h3 id={`${kind}-markdown-title`}>Markdownで読める説明</h3>
          <p>グラフで方向を掴んだ後、判断理由と補足を文章で確認します。</p>
        </div>
      </div>
      <div className={styles.markdownPanel}>
        {excerpt ? <MarkdownRenderer content={excerpt} size="normal" variant="discovery" /> : (
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
          <DiscoveryFoundSet insights={insights} />
          <ComparisonBars insights={insights} kind="discovery" />
          <PositionSketch insights={insights} />
          <MarkdownChapter reportMd={reportMd} insights={insights} kind="discovery" />
        </>
      ) : (
        <>
          <CompareScope insights={insights} />
          <MarkdownChapter reportMd={reportMd} insights={insights} kind="compare" />
          <ComparisonBars insights={insights} kind="compare" />
          <ActionChapter insights={insights} />
        </>
      )}
    </section>
  )
}
