import { useMemo } from 'react'
import { buildReportDecisionInsights } from '../../../utils/reportDecisionInsights'
import styles from './ActionBoardV2.module.css'

function ConfidenceBadge({ confidence }) {
  return (
    <span className={`${styles.confidence} ${styles[`confidence_${confidence.key}`]}`}>
      <span className="material-symbols-outlined" aria-hidden="true">{confidence.icon}</span>
      信頼度 {confidence.label}
    </span>
  )
}

function PriorityMeter({ label, value, tone }) {
  return (
    <div className={styles.meterBlock}>
      <div className={styles.meterLabel}>
        <span>{label}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <div className={styles.meterTrack} aria-hidden="true">
        <span className={`${styles.meterFill} ${styles[tone]}`} style={{ width: `${Math.max(8, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

export default function ActionBoardV2({ envelope, reportMd, kind = 'compare' }) {
  const insights = useMemo(
    () => buildReportDecisionInsights({ envelope, reportMd }),
    [envelope, reportMd],
  )
  const { topAction, actions, evidence, brands, evidenceItems, tiers } = insights
  const hasClassificationRisk = (tiers.counts.out_of_scope || 0) > 0 || evidence.pending > evidence.confirmed
  const isDiscovery = kind === 'discovery'

  if (!topAction && !actions.length && !brands.length) return null

  return (
    <section
      className={`${styles.board} md-v2-enter`}
      aria-labelledby="action-board-v2-title"
      data-testid="action-board-v2"
    >
      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.eyebrow}>Action Board / Decision Board</span>
          <h2 id="action-board-v2-title" className={styles.title}>
            {isDiscovery ? '比較へ送る候補' : '結論ボード'}
          </h2>
          <p className={styles.lead}>
            {isDiscovery
              ? '長文レポートを読む前に、市場定義・候補分類・比較対象に残す理由を確認できます。'
              : '長文レポートを読む前に、勝ち筋・不足根拠・最初に直すCTAを確認できます。'}
          </p>
        </div>

        <article className={styles.primaryAction}>
          <div className={styles.actionLabel}>
            <span className="material-symbols-outlined" aria-hidden="true">{isDiscovery ? 'manage_search' : 'flag'}</span>
            {isDiscovery ? 'Compare Handoff' : '最重要ポイント'}
          </div>
          <h3 className={styles.actionTitle}>{topAction.title}</h3>
          {topAction.detail && <p className={styles.actionDetail}>{topAction.detail}</p>}

          <div className={styles.kpiRow}>
            <div>
              <span className={styles.kpiLabel}>担当領域</span>
              <strong>{topAction.ownerArea}</strong>
            </div>
            <div>
              <span className={styles.kpiLabel}>期待KPI</span>
              <strong>{topAction.expectedKpi}</strong>
            </div>
            <ConfidenceBadge confidence={topAction.confidence || evidence.confidence} />
          </div>

          <div className={styles.whyNow}>
            <span className="material-symbols-outlined" aria-hidden="true">priority_high</span>
            <div>
              <span>なぜ今やるか</span>
              <p>{topAction.whyNow || topAction.detail}</p>
            </div>
          </div>

          <div className={styles.nextStep}>
            <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>
            <div>
              <strong>初回タスク</strong>
              <span>{topAction.firstStep}</span>
            </div>
          </div>

          {hasClassificationRisk && (
            <div className={styles.classificationRisk}>
              <span className="material-symbols-outlined" aria-hidden="true">rule_settings</span>
              <div>
                <strong>競合分類の確認が必要</strong>
                <span>
                  対象外 {tiers.counts.out_of_scope || 0} 件 / 評価保留 {evidence.pending} 件。広告施策化前に直接競合だけを主比較に残してください。
                </span>
              </div>
            </div>
          )}
        </article>
      </div>

      <aside className={styles.side} aria-label="施策判断の補助情報">
        <div className={styles.metricGrid}>
          <div className={styles.metric}>
            <span className="material-symbols-outlined" aria-hidden="true">fact_check</span>
            <div>
              <strong>{evidence.confirmed}</strong>
              <span>確認済み根拠</span>
            </div>
          </div>
          <div className={styles.metric}>
            <span className="material-symbols-outlined" aria-hidden="true">pending</span>
            <div>
              <strong>{evidence.pending}</strong>
              <span>評価保留</span>
            </div>
          </div>
        </div>

        <div className={styles.meters}>
          <div className={styles.matrixTitle}>Priority Matrix</div>
          <PriorityMeter label="Impact" value={topAction.impact} tone="impact" />
          <PriorityMeter label="Effort" value={topAction.effort} tone="effort" />
          <PriorityMeter label="Confidence" value={
            topAction.confidence?.key === 'high' ? 88 :
            topAction.confidence?.key === 'low' ? 36 :
            topAction.confidence?.key === 'pending' ? 28 : 62
          } tone="confidenceFill" />
        </div>

        {actions.length > 1 && (
          <div className={styles.queue}>
            <span className={styles.queueTitle}>次点施策</span>
            {actions.slice(1, 4).map((action, idx) => (
              <div key={`${action.title}-${idx}`} className={styles.queueItem}>
                <span>{idx + 2}</span>
                <p>{action.title}</p>
              </div>
            ))}
          </div>
        )}

        {evidenceItems.length > 0 && (
          <div className={styles.evidenceList} aria-label="根拠チップ">
            <span className={styles.queueTitle}>Evidence Chips</span>
            {evidenceItems.slice(0, 4).map((item, idx) => (
              <div key={`${item.label}-${idx}`} className={styles.evidenceChip}>
                <span className="material-symbols-outlined" aria-hidden="true">{item.level.icon}</span>
                <p>
                  <strong>{item.label}</strong>
                  <small>{item.observation || item.sourceUrl || item.level.helper}</small>
                </p>
              </div>
            ))}
          </div>
        )}

        <div className={styles.tierSummary} aria-label="競合分類">
          {[
            ['direct', '直接競合'],
            ['adjacent', '隣接競合'],
            ['reference', '参考サイト'],
            ['out_of_scope', '対象外'],
          ].map(([key, label]) => (
            <div key={key} className={styles.tierPill}>
              <strong>{tiers.counts[key] || 0}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}
