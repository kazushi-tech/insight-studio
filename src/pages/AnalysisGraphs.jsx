import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_EXPIRED_MESSAGE, neonGenerate } from '../api/adsInsights'
import ChartGroupCard from '../components/ads/ChartGroupCard'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SourceBadge from '../components/ads/SourceBadge'
import ExcelImportBanner from '../components/ads/ExcelImportBanner'
import ExcelImportPreview from '../components/ads/ExcelImportPreview'
import ExcelImportStatusStrip from '../components/ads/ExcelImportStatusStrip'
import AiContextRail from '../components/ai-assistant/AiContextRail'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import {
  getChartPeriodTags,
  getDisplayChartGroups,
  regenerateAdsReportBundle,
  buildAiChartContext,
  buildChartEvidencePack,
  buildAnalysisInstructions,
  normalizeChartGroupShape,
  extractMarkdownSummary,
  selectChartGroupsForPrompt,
} from '../utils/adsReports'
import { analyzeChartReadability } from '../utils/chartReadability'
import { extractInsightMeta, extractInsightReport, getAdsText, normalizeAdsPayload } from '../utils/adsResponse'
import { getAnalysisModel } from '../utils/analysisProvider'
import {
  groupChartsByTheme,
  extractTopInsights,
  computeThemeSummary,
  THEME_DEFINITIONS,
} from '../utils/chartThemeClassifier'
import { parseExcelFile } from '../utils/excelImporter'
import {
  extractExecutiveCards,
  extractRefinedInsights,
  extractDataQualityAlerts,
} from '../utils/executiveSummaryExtractor'

/* ── Section IDs for local nav ── */
const SECTIONS = [
  { id: 'graphs', label: 'グラフ分析', icon: 'bar_chart' },
  { id: 'creative', label: 'クリエイティブ', icon: 'palette' },
  { id: 'detail-report', label: '詳細レポート', icon: 'description' },
]

const ADS_QUERY_LABELS = {
  pv: 'PV分析',
  traffic: '流入分析',
  cv: 'CV分析',
  search: '検索クエリ分析',
  anomaly: '異常検知',
  landing: 'LP分析',
  device: 'デバイス分析',
  hourly: '時間帯分析',
  user_attr: 'ユーザー属性',
  engagement: 'エンゲージメント時間',
  auction_proxy: '流入の競合影響チェック（推定）',
}

const QUERY_STATUS_STYLES = {
  success: {
    label: 'グラフ反映済み',
    className: 'border-primary/15 bg-primary/[0.045]',
    valueClassName: 'text-primary',
  },
  no_chart: {
    label: '取得済み / グラフ0件',
    className: 'border-amber-200 bg-amber-50/60',
    valueClassName: 'text-amber-700',
  },
  no_data: {
    label: 'データ0件',
    className: 'border-outline-variant/25 bg-surface-container-low',
    valueClassName: 'text-on-surface-variant',
  },
  error: {
    label: 'エラー',
    className: 'border-error/25 bg-error-container/50',
    valueClassName: 'text-error',
  },
  unknown: {
    label: '実行結果未取得',
    className: 'border-outline-variant/25 bg-surface-container-low',
    valueClassName: 'text-on-surface-variant',
  },
}

function summarizeQueryExecution(selectedQueryTypes, executionSummary = [], chartGroups = []) {
  const statusRank = { success: 4, no_chart: 3, no_data: 2, error: 1, unknown: 0 }
  return selectedQueryTypes.map((queryType) => {
    const entries = executionSummary.filter((entry) => (entry.queryType || entry.query_type) === queryType)
    if (entries.length === 0) {
      const legacyChartCount = chartGroups.filter((group) => (group?.queryType || group?.metadata?.queryType) === queryType).length
      if (legacyChartCount > 0) {
        return {
          queryType,
          status: 'success',
          rowCount: null,
          chartGroupCount: legacyChartCount,
          message: 'チャートメタデータから反映を確認しました。再取得後は行数も表示されます。',
        }
      }
      return { queryType, status: 'unknown', rowCount: null, chartGroupCount: 0, message: 'バックエンド実行結果がまだありません。' }
    }

    const status = entries
      .map((entry) => entry.status || 'unknown')
      .sort((a, b) => (statusRank[b] ?? 0) - (statusRank[a] ?? 0))[0] || 'unknown'
    const chartGroupCount = entries.reduce((sum, entry) => sum + Number(entry.chartGroupCount ?? entry.chart_group_count ?? 0), 0)
    const rowValues = entries
      .map((entry) => entry.rowCount ?? entry.row_count)
      .filter((value) => Number.isFinite(Number(value)))
      .map(Number)
    const rowCount = rowValues.length > 0 ? rowValues.reduce((sum, value) => sum + value, 0) : null
    const message = entries.map((entry) => entry.message).filter(Boolean)[0] || ''

    return { queryType, status, rowCount, chartGroupCount, message }
  })
}

function QueryCoverageSummary({ setupState, reportBundle, filteredGroups, periodLabel }) {
  const selectedQueryTypes = setupState?.queryTypes ?? []
  if (selectedQueryTypes.length === 0) return null

  const summaries = summarizeQueryExecution(selectedQueryTypes, reportBundle?.executionSummary ?? [], filteredGroups)

  return (
    <section className="rounded-xl border border-primary/15 bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-primary">
            <span className="material-symbols-outlined text-base" aria-hidden="true">fact_check</span>
            反映状況
          </span>
          <h3 className="mt-2 text-xl font-extrabold text-on-surface japanese-text">選択クエリと表示期間グラフの対応</h3>
          <p className="mt-1 text-sm leading-6 text-on-surface-variant japanese-text">
            バックエンドの実行結果ごとに、取得行数・グラフ件数・0件/エラーを切り分けます。
          </p>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-right">
          <p className="text-[10px] font-black tracking-[0.12em] text-on-surface-variant">表示対象</p>
          <p className="mt-1 text-sm font-black text-primary japanese-text">{periodLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaries.map(({ queryType, status, rowCount, chartGroupCount, message }) => {
          const style = QUERY_STATUS_STYLES[status] ?? QUERY_STATUS_STYLES.unknown
          return (
            <div key={queryType} className={`rounded-xl border px-4 py-3 ${style.className}`}>
              <p className="text-sm font-black text-on-surface japanese-text">{ADS_QUERY_LABELS[queryType] ?? queryType}</p>
              <p className={`mt-2 text-2xl font-black tabular-nums ${style.valueClassName}`}>
                {chartGroupCount}件
              </p>
              <p className="mt-1 text-[11px] font-bold text-on-surface-variant">
                {style.label}{rowCount != null ? ` / ${rowCount.toLocaleString('ja-JP')}行` : ''}
              </p>
              {message && <p className="mt-2 line-clamp-2 text-[10px] font-bold leading-4 text-on-surface-variant">{message}</p>}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs font-bold text-on-surface-variant japanese-text">
        現在表示中: {filteredGroups.length}グラフ。少ない場合でも「未取得」「データ0件」「グラフ生成0件」「エラー」を分けて確認できます。
      </p>
    </section>
  )
}

/* ── Evidence Type styles ── */
const EVIDENCE_STYLES = {
  observed: { text: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/20', label: '実測' },
  derived:  { text: 'text-secondary', bg: 'bg-secondary/5', border: 'border-secondary/20', label: '導出' },
  proxy:    { text: 'text-accent-gold', bg: 'bg-accent-gold/10', border: 'border-accent-gold/20', label: '代替' },
  inferred: { text: 'text-tertiary', bg: 'bg-tertiary/5', border: 'border-tertiary/20', label: '推論' },
}

const AI_RAIL_COLLAPSED_STORAGE_KEY = 'insight-studio.adsGraphs.aiRailCollapsed'
const GRAPH_AI_HTML_REPORT_INSTRUCTIONS = [
  '回答は右カラムで読める短いMarkdownレポートにしてください。',
  '構成は次だけに絞ってください。',
  '1. 結論: 1〜2文。初心者にも分かる言葉で書く。',
  '2. 根拠表: chart_id / グラフ名 / 指標 / 値 / 期間 のMarkdownテーブル。',
  '3. 読み解き: 2〜4文。原因は断定せず、必要なら「仮説」と書く。',
  '4. 次に見ること: 3件まで。',
  '5. 初心者向けの一言: 専門用語を避け、「つまり何を見るべきか」を1文で書く。',
  '6. シニア広告運用レビュー: 実務で次に見る媒体データと判断保留を明記する。',
  '7. 整合性確認: chart_id、日付表記ゆれ、本文と根拠表の数値一致を確認する。',
  '',
  '禁止:',
  '- 根拠にないCPA、ROAS、CTR、広告費、CVRを断定しない。',
  '- エージェント名だけを並べて中身のない説明にしない。',
  '- 同じ数値や同じグラフを繰り返し並べない。',
  '',
  '回答の末尾に、必ず次の fenced JSON ブロックを追加してください。',
  '```insight-report',
  '{',
  '  "version": "insight_report_v2",',
  '  "executive_summary": ["1〜2文の結論"],',
  '  "evidence_table": [{"claim": "主張", "metric": "指標", "value": "値", "period": "期間", "source": "chart_id", "confidence": "high|medium|low"}],',
  '  "interpretation": ["2〜4文の読み解き"],',
  '  "hypotheses": [{"hypothesis": "仮説", "evidence": "根拠chart_id", "missing_data": "不足データ"}],',
  '  "actions": [{"priority": "P0|P1|P2", "action": "施策", "rationale": "根拠", "expected_metric": "見る指標"}],',
  '  "limitations": ["断定できないこと"],',
  '  "review_status": {"verdict": "pass|needs_review", "notes": ["数値照合", "初心者説明", "Senior AdOps Reviewer", "Consistency Agent"]}',
  '}',
  '```',
  'JSON内にHTMLタグは入れず、右カラムで読みやすい短めの文字列にしてください。',
].join('\n')

/* ── Evidence Type colour map (for EvidenceDrawer) ── */
const TYPE_STYLES = {
  observed: { bg: 'bg-primary/5', border: 'border-primary/10', text: 'text-primary', badgeBg: 'bg-primary/10', label: '実測', borderL: 'border-l-primary' },
  derived:  { bg: 'bg-secondary/5', border: 'border-secondary/10', text: 'text-secondary', badgeBg: 'bg-secondary/10', label: '導出', borderL: 'border-l-secondary' },
  proxy:    { bg: 'bg-outline-variant/5', border: 'border-outline-variant/20', text: 'text-on-surface-variant', badgeBg: 'bg-outline-variant/10', label: '代替', borderL: 'border-l-outline-variant' },
  inferred: { bg: 'bg-tertiary/5', border: 'border-tertiary/10', text: 'text-tertiary', badgeBg: 'bg-tertiary/10', label: '推論', borderL: 'border-l-tertiary' },
}

/* ── Evidence Drawer ── */
function EvidenceDrawer({ cards, reportBundle }) {
  if (!cards || cards.length === 0) return null

  return (
    <div className="fixed bottom-16 left-0 right-0 z-30 lg:bottom-0">
      <details className="group bg-surface-container-lowest border-t border-outline-variant shadow-[0_-10px_30px_rgba(0,0,0,0.08)]">
        <summary className="flex items-center justify-between px-8 py-3 cursor-pointer list-none hover:bg-surface-container-low transition-colors select-none">
          <div className="flex items-center gap-4">
            <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">keyboard_arrow_up</span>
            <span className="text-[12px] font-bold text-on-surface-variant tracking-widest">根拠データ</span>
          </div>
          <div className="flex gap-4 items-center">
            {reportBundle?.generatedAt && (
              <span className="text-[10px] text-primary font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 bg-primary rounded-full" />
                最終同期: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
              </span>
            )}
          </div>
        </summary>
        <div className="px-8 pb-10 pt-6 bg-surface-container-lowest max-h-[500px] overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {cards.map((card) => {
              const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed
              return (
                <div key={card.evidenceId} id={`${card.evidenceId}-detail`} className={`p-5 border border-outline-variant/15 rounded-xl ${style.bg}`}>
                  <div className="flex items-center gap-2 mb-3 border-b border-outline-variant/10 pb-2">
                    <span className={`evidence-tag ${style.badgeBg} ${style.text} border ${style.border}`}>
                      {style.label}
                    </span>
                    <span className="text-[9px] font-bold text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">{card.evidenceId}</span>
                  </div>
                  <p className="text-xs font-bold text-on-surface mb-2">{card.label}</p>
                  <div className="space-y-1.5 text-[11px] text-on-surface-variant">
                    <div className="flex justify-between">
                      <span className="font-medium">ソース</span>
                      <span className="font-bold text-on-surface">{card.source ?? 'BQ / GA4'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">値</span>
                      <span className="font-bold text-on-surface tabular-nums">{card.value}</span>
                    </div>
                    {card.trend && (
                      <div className="flex justify-between">
                        <span className="font-medium">変化</span>
                        <span className={`font-bold tabular-nums ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface'}`}>{card.trend}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </details>
    </div>
  )
}


/* ── Creative Filter Tabs ── */
const CREATIVE_FILTERS = [
  { id: 'all', label: 'すべて' },
  { id: 'banner', label: 'バナー' },
  { id: 'text', label: 'テキスト' },
]

/* ── Text Ad Card ── */
function TextAdCard({ adRef, index }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl ghost-border overflow-hidden flex flex-col">
      <div className="p-4 bg-primary/5 border-b border-outline-variant/10">
        <span className="text-[10px] font-bold text-primary tracking-widest">テキスト広告 #{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="p-6 flex-1 space-y-4">
        <div className="p-3 bg-surface rounded border border-outline-variant/20">
          <p className="text-sm font-bold text-primary mb-1 underline japanese-text line-clamp-1">
            {adRef.name ?? `テキスト広告 ${index + 1}`}
          </p>
          {adRef.description && (
            <p className="text-xs text-on-surface-variant line-clamp-3 japanese-text">{adRef.description}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {adRef.kpis?.click != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">Clicks</div>
              <div className="text-sm font-bold">{adRef.kpis.click.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cv != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CV</div>
              <div className="text-sm font-bold">{adRef.kpis.cv.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cvr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CVR</div>
              <div className="text-sm font-bold text-primary">{adRef.kpis.cvr.toFixed(2)}%</div>
            </div>
          )}
          {adRef.kpis?.ctr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CTR</div>
              <div className="text-sm font-bold">{adRef.kpis.ctr.toFixed(2)}%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Banner Ad Card ── */
function BannerAdCard({ adRef, index }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl ghost-border overflow-hidden flex flex-col border border-primary/20">
      <div className="relative h-40">
        {adRef.imageUrl ? (
          <img
            src={adRef.imageUrl}
            alt={adRef.name ?? `バナー広告 ${index + 1}`}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full bg-surface-container-low flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-outline-variant">image</span>
          </div>
        )}
        <div className="absolute top-3 left-3 px-2 py-1 bg-primary text-on-primary text-[10px] font-bold rounded">
          バナー広告 #{String(index + 1).padStart(2, '0')}
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {adRef.kpis?.click != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">Clicks</div>
              <div className="text-sm font-bold">{adRef.kpis.click.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cv != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CV</div>
              <div className="text-sm font-bold">{adRef.kpis.cv.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cvr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CVR</div>
              <div className="text-sm font-bold text-primary">{adRef.kpis.cvr.toFixed(2)}%</div>
            </div>
          )}
          {adRef.kpis?.ctr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CTR</div>
              <div className="text-sm font-bold">{adRef.kpis.ctr.toFixed(2)}%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Key Chart Picker (pick 2 most insightful) ── */
function pickKeyCharts(chartGroups) {
  if (!chartGroups || chartGroups.length === 0) return []
  const scored = chartGroups.map((g) => {
    const title = (g.title ?? '').toLowerCase()
    let score = 0
    if (/click|cvr|cv数|cpa|ctr|コンバージョン|推移|trend/i.test(title)) score += 3
    if (/比較|ranking|campaign|キャンペーン|広告グループ/i.test(title)) score += 2
    if (Array.isArray(g.datasets) && g.datasets.length > 0) score += 1
    if (Array.isArray(g.labels) && g.labels.length >= 3) score += 1
    return { group: g, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 2).map((s) => s.group)
}

/* ── Theme Tabs (analyst supplement) ── */
function ThemeTabs({ activeTheme, onThemeChange, themes }) {
  const allTabs = [{ id: 'all', label: '全件', icon: 'select_all' }, ...THEME_DEFINITIONS]

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 border-b border-outline-variant/20">
      {allTabs.map((tab) => {
        const hasData = tab.id === 'all' || themes.some((t) => t.id === tab.id)
        return (
          <button
            key={tab.id}
            onClick={() => onThemeChange(tab.id)}
            disabled={!hasData}
            className={`whitespace-nowrap px-6 py-2 rounded-full text-sm font-bold transition-colors ${
              activeTheme === tab.id
                ? 'bg-primary text-on-primary shadow-sm'
                : hasData
                ? 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                : 'bg-surface-container-low text-on-surface-variant/30 cursor-not-allowed'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function formatRawTableValue(value) {
  if (value == null || value === '') return '欠損'
  if (typeof value === 'number') return Number.isFinite(value) ? value : '算出不可'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return '欠損'
    if (['none', 'nan', 'null'].includes(trimmed.toLowerCase())) return '欠損'
    return value
  }
  return value
}

function stripInsightJsonFences(markdown) {
  return String(markdown ?? '')
    .replace(/```insight-report\s*[\s\S]*?```/g, '')
    .replace(/```insight-meta\s*[\s\S]*?```/g, '')
    .trim()
}

function pickInlineQuestionGroups(prompt, allGroups = [], fallbackGroups = []) {
  const selected = selectChartGroupsForPrompt(allGroups, prompt, { maxGroups: 12, fallbackOnNoMatch: false })
  if (selected.length > 0) {
    return selected.map(normalizeChartGroupShape)
  }
  const text = String(prompt ?? '')
  const normalizedAllGroups = Array.isArray(allGroups)
    ? allGroups.map(normalizeChartGroupShape)
    : []
  const directMatches = normalizedAllGroups.filter((group) => {
    const title = String(group?.title ?? '')
    const selection = String(group?.selectionLabel ?? group?.metadata?.selectionLabel ?? '')
    return (title && text.includes(title)) || (selection && text.includes(selection))
  })
  if (directMatches.length > 0) return directMatches

  const themeHints = [
    ['流入の競合影響チェック（推定）', ['流入分析', '流入の競合影響', 'チャネル', '参照元', 'organic', 'direct', 'referral']],
    ['PV分析', ['PV分析', 'PV数', 'ページビュー']],
    ['LP分析', ['LP分析', 'ランディング', 'LP']],
    ['デバイス分析', ['デバイス分析', 'デバイス', 'OS']],
    ['時間帯分析', ['時間帯分析', '時間帯', '何時']],
    ['異常検知', ['異常検知', '異常', 'Z-score']],
    ['検索クエリ', ['検索クエリ', '検索語句', 'クエリ']],
  ]
  const matchedTheme = themeHints.find(([, hints]) => hints.some((hint) => text.includes(hint)))
  if (matchedTheme) {
    const [themeLabel] = matchedTheme
    const themeMatches = normalizedAllGroups.filter((group) => String(group?.title ?? '').includes(themeLabel))
    if (themeMatches.length > 0) return themeMatches
  }

  return Array.isArray(fallbackGroups) && fallbackGroups.length > 0
    ? fallbackGroups.map(normalizeChartGroupShape)
    : normalizedAllGroups
}

function InlineStructuredReport({ report, markdown }) {
  if (!report) return null
  const summary = report.executive_summary?.slice(0, 3) ?? []
  const evidence = report.evidence_table?.slice(0, 5) ?? []
  const actions = report.actions?.slice(0, 3) ?? []
  const limitations = report.limitations?.slice(0, 3) ?? []
  const reviewVerdict = report.review_status?.verdict || 'checked'
  const detailMarkdown = String(markdown ?? '').trim()

  return (
    <div data-testid="ads-graph-inline-report-v2" className="space-y-3">
      {summary.length > 0 && (
        <section className="rounded-xl border border-primary/15 bg-primary/[0.045] p-3">
          <p className="mb-2 text-[10px] font-black tracking-[0.14em] text-primary">重要結論</p>
          <div className="space-y-2">
            {summary.map((item, index) => (
              <p key={`${item}-${index}`} className="grid grid-cols-[1.65rem_1fr] gap-2 text-xs leading-6 text-on-surface japanese-text">
                <b className="grid size-6 place-items-center rounded-lg bg-primary text-[10px] text-on-primary">{index + 1}</b>
                <span>{item}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      {evidence.length > 0 && (
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black tracking-[0.14em] text-on-surface-variant">
            <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">dataset</span>
            根拠テーブル
          </p>
          <div className="space-y-2">
            {evidence.map((row, index) => (
              <div key={`${row.source}-${row.metric}-${index}`} className="rounded-lg bg-surface-container-low p-2.5">
                <p className="text-xs font-bold leading-5 text-on-surface japanese-text">{row.claim || '-'}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <span className="rounded-md bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                    指標: <b className="text-primary">{row.metric || '-'}</b>
                  </span>
                  <span className="rounded-md bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                    値: <b className="text-primary">{row.value || '-'}</b>
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-on-surface-variant japanese-text">
                  {[row.period, row.source, row.confidence].filter(Boolean).join(' / ') || '-'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <section className="rounded-xl border border-primary/15 bg-surface-container-lowest p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black tracking-[0.14em] text-on-surface-variant">
            <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">task_alt</span>
            優先施策
          </p>
          <div className="space-y-2">
            {actions.map((row, index) => (
              <div key={`${row.priority}-${row.action}-${index}`} className="grid grid-cols-[2.1rem_1fr] gap-2 rounded-lg bg-surface-container-low p-2.5">
                <b className="grid size-8 place-items-center rounded-lg bg-primary text-[11px] text-on-primary">
                  {row.priority || `P${index}`}
                </b>
                <div>
                  <p className="text-xs font-bold leading-5 text-on-surface japanese-text">{row.action || '施策未指定'}</p>
                  <p className="mt-1 text-[11px] leading-5 text-on-surface-variant japanese-text">{row.rationale || row.expected_metric || '根拠テーブルを参照'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(limitations.length > 0 || reviewVerdict) && (
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black tracking-[0.14em] text-on-surface-variant">
            <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">rule</span>
            Review Agent: {reviewVerdict}
          </p>
          {limitations.map((item, index) => (
            <p key={`${item}-${index}`} className="text-[11px] leading-5 text-on-surface-variant japanese-text">
              {item}
            </p>
          ))}
        </section>
      )}

      {detailMarkdown && (
        <details className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3">
          <summary className="cursor-pointer text-xs font-bold text-primary japanese-text">詳細Markdownを開く</summary>
          <div className="mt-3 text-xs leading-6 text-on-surface japanese-text">
            <MarkdownRenderer content={detailMarkdown} variant="ai-insight" size="normal" />
          </div>
        </details>
      )}
    </div>
  )
}

function InlineAgentTracePanel({ trace = [] }) {
  const items = Array.isArray(trace) ? trace.filter((item) => item && typeof item === 'object') : []
  if (items.length === 0) return null
  return (
    <details className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3" data-testid="ads-graph-agent-trace-panel">
      <summary className="cursor-pointer text-xs font-bold text-primary japanese-text">
        複数ステージAIレビュー（{items.length}つの役割で順番に検査）
      </summary>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={`${item.stage}-${index}`} className="rounded-lg bg-surface-container-low p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black text-on-surface">{item.label || item.stage}</p>
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">
                {item.mode || 'unknown'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-on-surface-variant japanese-text">
              {item.summary || item.excerpt || '検査完了'}
            </p>
            {Array.isArray(item.checks) && item.checks.length > 0 && (
              <p className="mt-1 text-[10px] leading-5 text-on-surface-variant japanese-text">
                確認: {item.checks.slice(0, 4).join(' / ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

/* ── Graph Section (Accordion for analyst) ── */
function GraphSection({ theme, isOpen, onToggle, viewMode }) {
  const summary = useMemo(() => computeThemeSummary(theme.groups), [theme.groups])

  return (
    <div id={`theme-section-${theme.id}`} className="overflow-hidden rounded-xl border border-outline-variant/25 bg-surface-container-lowest shadow-sm scroll-mt-24">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex w-full cursor-pointer flex-col gap-4 border-b border-primary/10 px-4 py-5 text-left transition-colors hover:bg-primary/[0.04] sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-[10px] font-black tracking-[0.16em] text-primary">グラフテーマ</p>
              <h3 className="mt-1 font-black text-xl text-primary japanese-text">{theme.label}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] font-black bg-surface-container-lowest px-3 py-1 rounded-full border border-primary/10">
                {summary.chartCount} グラフ
              </span>
              {summary.criticalShifts > 0 && (
                <span className="text-[10px] font-black bg-primary text-on-primary px-3 py-1 rounded-full">
                  重要変化 {summary.criticalShifts} 件
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 text-sm font-medium text-on-surface-variant sm:justify-end">
          <div className="flex items-center gap-2 rounded-full border border-primary/10 bg-surface-container-lowest px-4 py-2">
            <span className={`size-2.5 rounded-full ${summary.criticalShifts > 0 ? 'bg-accent-gold' : 'bg-primary'}`} />
            品質: {summary.criticalShifts > 0 ? '注意' : '良好'}
          </div>
          <span
            className="grid size-10 place-items-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-primary transition group-hover:bg-primary group-hover:text-on-primary"
            aria-hidden="true"
          >
            <span className={`material-symbols-outlined text-xl transition-transform ${isOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="p-6 lg:p-8">
          <div className="grid grid-cols-1 gap-8">
            {theme.groups.map((group, groupIndex) => {
              const normalizedGroup = normalizeChartGroupShape(group)
              const readability = analyzeChartReadability(normalizedGroup, normalizedGroup.chartType)
              const shouldStayOpen =
                readability.recommendedDisplayMode === 'flat_diagnostic' ||
                readability.recommendedDisplayMode === 'low_sample_table' ||
                readability.recommendedDisplayMode === 'focused_line' ||
                normalizedGroup.chartType === 'bar_horizontal'
              const shouldCollapse =
                !shouldStayOpen && (groupIndex >= 2 || (normalizedGroup.labels?.length ?? 0) > 12)
              return (
                <ChartGroupCard
                  key={`${group.title ?? 'group'}-${group._periodTag ?? 'merged'}-${groupIndex}`}
                  group={{ ...normalizedGroup, defaultCollapsed: shouldCollapse }}
                />
              )
            })}
          </div>

          {viewMode === 'analyst' && theme.groups.length > 0 && (
            <div className="mt-8 space-y-6">
              <h4 className="font-bold text-xs text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">table_chart</span>
                生データテーブル
              </h4>
              {theme.groups.map((group, gIdx) => {
                const normalizedGroup = normalizeChartGroupShape(group)
                const labels = Array.isArray(normalizedGroup.labels) ? normalizedGroup.labels : []
                const datasets = Array.isArray(normalizedGroup.datasets) ? normalizedGroup.datasets : []
                if (labels.length === 0 || datasets.length === 0) return null
                const warnings = Array.isArray(normalizedGroup.warnings) ? normalizedGroup.warnings : []

                return (
                  <div key={gIdx} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-bold text-on-surface japanese-text">{normalizedGroup.title ?? '無題'}</p>
                      {normalizedGroup._periodTag && (
                        <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{normalizedGroup._periodTag}</span>
                      )}
                      {normalizedGroup.coverageLabel && (
                        <span className="text-[10px] font-bold text-primary bg-primary/[0.08] px-2 py-0.5 rounded">{normalizedGroup.coverageLabel}</span>
                      )}
                      {warnings.length > 0 && (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded">欠損/注意あり</span>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-outline-variant/30 shadow-sm max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-surface-container-high text-on-surface-variant font-bold text-xs sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 sticky left-0 bg-surface-container-high z-20 whitespace-nowrap">日付 / カテゴリ</th>
                            {datasets.map((ds, dsIdx) => (
                              <th key={dsIdx} className="px-4 py-3 text-right whitespace-nowrap">{ds.label || `系列${dsIdx + 1}`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10 text-on-surface bg-surface-container-lowest">
                          {labels.map((label, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-surface-container-low transition-colors">
                              <td className="px-4 py-2 font-medium text-on-surface-variant sticky left-0 bg-surface-container-lowest whitespace-nowrap text-xs">{label}</td>
                              {datasets.map((ds, dsIdx) => (
                                <td key={dsIdx} className="px-4 py-2 text-right font-medium tabular-nums text-xs">
                                  {formatRawTableValue(ds.data?.[rowIdx])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Anomaly Detection Section ── */
function AnomalySection({ chartGroups }) {
  const anomalies = useMemo(() => {
    const detected = []
    for (const group of chartGroups) {
      const datasets = Array.isArray(group?.datasets) ? group.datasets : []
      const labels = Array.isArray(group?.labels) ? group.labels : []

      for (const ds of datasets) {
        const data = (Array.isArray(ds?.data) ? ds.data : []).map((v) => {
          if (v == null) return null
          const n = typeof v === 'string' ? Number(v.replace(/,/g, '').replace(/[%％]$/, '')) : Number(v)
          return Number.isFinite(n) ? n : null
        })

        const validData = data.filter((v) => v !== null)
        if (validData.length < 3) continue

        const mean = validData.reduce((s, v) => s + v, 0) / validData.length
        const variance = validData.reduce((s, v) => s + (v - mean) ** 2, 0) / validData.length
        const stdDev = Math.sqrt(variance)
        if (stdDev === 0) continue

        const title = (group.title ?? '').toLowerCase()
        const isNonNegative = !/率|%|％|cvr|ctr|rate|ratio|share/i.test(title)

        for (let i = 0; i < data.length; i++) {
          if (data[i] === null) continue
          const zScore = Math.abs((data[i] - mean) / stdDev)
          if (zScore >= 2) {
            const lowerBound = mean - stdDev
            detected.push({
              chartTitle: group.title ?? '無題',
              date: labels[i] ?? `point-${i}`,
              actual: data[i],
              expected: mean,
              expectedRange: [isNonNegative ? Math.max(0, lowerBound) : lowerBound, mean + stdDev],
              zScore: zScore.toFixed(1),
              direction: data[i] < mean ? 'down' : 'up',
              seriesLabel: ds.label ?? '',
            })
          }
        }
      }
    }
    return detected.slice(0, 5)
  }, [chartGroups])

  if (anomalies.length === 0) return null

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20">
      <div className="p-5 flex items-center justify-between border-b border-outline-variant/10 bg-tertiary/[0.02]">
        <div className="flex items-center gap-6">
          <span className="material-symbols-outlined text-tertiary">warning</span>
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-lg japanese-text">異常検知</h3>
            <span className="text-[10px] font-bold bg-tertiary-container text-on-tertiary px-2 py-0.5 rounded uppercase">
              {anomalies.length} detected
            </span>
          </div>
        </div>
      </div>
      <div className="p-8 space-y-4">
        {anomalies.map((anomaly, idx) => (
          <div key={idx} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/10 flex items-start gap-4">
            <span className={`material-symbols-outlined text-lg ${anomaly.direction === 'down' ? 'text-error' : 'text-accent-gold'}`}>
              {anomaly.direction === 'down' ? 'trending_down' : 'trending_up'}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-on-surface japanese-text">{anomaly.chartTitle}</p>
                <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{anomaly.date}</span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1">
                実測: <span className="font-bold text-error">{anomaly.actual.toLocaleString('ja-JP')}</span>
                {' / '}期待帯域: <span className="font-bold">{anomaly.expectedRange[0].toFixed(0)} - {anomaly.expectedRange[1].toFixed(0)}</span>
                {' / '}<span className="font-bold text-error">{anomaly.zScore}σ 逸脱</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AdsImage2KpiBoard({
  filteredGroups,
  themes,
  setupState,
  reportBundle,
  periodFilter,
  periodTags,
  onPeriodFilterChange,
  onChangeSetup,
  onScrollToGraphs,
}) {
  const generatedAt = reportBundle?.generatedAt
    ? new Date(reportBundle.generatedAt).toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '更新待ち'
  const availability = reportBundle?.dataAvailability || (reportBundle?.source === 'bq_generate_fallback' ? 'fallback' : 'full')
  const isFallback = availability === 'fallback' || reportBundle?.source === 'bq_generate_fallback'
  const isPartial = availability === 'partial'
  const isFailed = availability === 'failed'
  const availabilityLabel = isFailed ? '取得失敗' : isFallback ? '暫定表示' : isPartial ? '一部未取得' : '取得確認済み'
  const availabilityTitle = isFailed ? 'BigQuery 取得失敗' : isFallback ? 'BigQuery 取得未確定' : isPartial ? 'BigQuery 一部取得' : 'BigQuery 取得済み'
  const availabilityTone = (isFailed || isPartial || isFallback) ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
  const availabilityMessage = isFailed
    ? '全クエリが未取得です。条件と権限を確認してください'
    : isFallback
      ? '未取得データを成功扱いせず、確認手順と追加取得候補を表示しています'
      : isPartial
        ? `一部クエリが未取得です${reportBundle?.missingReason ? `: ${reportBundle.missingReason}` : ''}`
        : 'BigQueryからPythonで集計した最新データを表示しています'
  const hasTheme = (id) => themes.some((theme) => theme.id === id)

  const metrics = [
    { icon: 'stacked_line_chart', label: '表示グループ数', value: `${filteredGroups.length}件`, delta: isFallback ? '暫定' : '統合後', tone: filteredGroups.length > 0 ? 'up' : 'neutral' },
    { icon: 'category', label: 'テーマ数', value: `${themes.length}分類`, delta: 'Python分類', tone: themes.length > 0 ? 'up' : 'neutral' },
    { icon: 'shopping_cart', label: 'CVイベント', value: hasTheme('cv') ? '確認可' : '未取得', delta: 'GA4イベント', tone: hasTheme('cv') ? 'up' : 'neutral' },
    { icon: 'travel_explore', label: '流入分析', value: hasTheme('traffic') ? '確認可' : '未取得', delta: 'source/medium', tone: hasTheme('traffic') ? 'up' : 'neutral' },
    { icon: 'web_asset', label: 'LP分析', value: hasTheme('lp') ? '確認可' : '未取得', delta: 'landing page', tone: hasTheme('lp') ? 'up' : 'neutral' },
    { icon: 'error', label: '異常検知', value: hasTheme('anomaly') ? '確認可' : '未取得', delta: '追加取得で補完', tone: hasTheme('anomaly') ? 'up' : 'neutral' },
  ]

  const selectedQueryLabels = (setupState?.queryTypes ?? [])
    .map((queryType) => ADS_QUERY_LABELS[queryType] ?? queryType)
  const periodOptions = [
    { label: '最新期間', value: 'latest', helper: periodTags[periodTags.length - 1] ?? '-' },
    ...(periodTags.length > 1 ? [{ label: '全期間まとめ', value: 'all', helper: `${periodTags.length}期間` }] : []),
    ...periodTags.map((period) => ({ label: period, value: period, helper: '選択期間' })),
  ]
  const latestPeriodLabel = periodTags.length > 0 ? periodTags[periodTags.length - 1] : '-'

  return (
    <section className="rounded-[1.35rem] border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <span>広告グラフ</span>
            <span className="material-symbols-outlined text-base" aria-hidden="true">chevron_right</span>
            <span>AI考察</span>
            <span className="material-symbols-outlined text-base" aria-hidden="true">chevron_right</span>
            <span className="font-bold text-primary">分析グラフ</span>
          </div>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-on-surface japanese-text">分析グラフ</h2>
          <p className="mt-2 text-sm leading-7 text-on-surface-variant japanese-text">
            広告パフォーマンスのKPIサマリーです。グラフはこの下に続きます。
          </p>
        </div>
        <button
          type="button"
          onClick={onScrollToGraphs}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-5 py-3 text-sm font-bold text-on-surface hover:border-primary/30 hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">download</span>
          レポートをダウンロード
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-surface p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-extrabold text-on-surface japanese-text">選択中の分析条件</h3>
            <p className="mt-1 text-xs leading-6 text-on-surface-variant japanese-text">
              ウィザードで選んだクエリと期間だけをここに反映します。条件を変える場合は選び直してください。
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeSetup}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/[0.05] transition-colors"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">tune</span>
            セットアップで選び直す
          </button>
        </div>
        <div className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
            <p className="text-[11px] font-black tracking-widest text-on-surface-variant">選択クエリ</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedQueryLabels.length > 0 ? selectedQueryLabels.map((label) => (
                <span key={label} className="rounded-lg bg-primary/[0.08] px-3 py-1.5 text-xs font-bold text-primary japanese-text">
                  {label}
                </span>
              )) : (
                <span className="text-xs text-on-surface-variant">未選択</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
            <p className="text-[11px] font-black tracking-widest text-on-surface-variant">ウィザード選択期間</p>
            <p className="mt-2 text-sm font-extrabold text-primary japanese-text">
              {(setupState?.periods ?? []).length > 0 ? (setupState.periods.length === 1 ? setupState.periods[0] : `${setupState.periods[0]} 〜 ${setupState.periods[setupState.periods.length - 1]}`) : latestPeriodLabel}
            </p>
          </div>
        </div>
        <h3 className="text-base font-extrabold text-on-surface japanese-text">期間選択</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
          {periodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={periodFilter === option.value}
              onClick={() => onPeriodFilterChange(option.value)}
              className={`min-h-16 rounded-lg border px-4 py-3 text-left text-sm font-bold transition-colors ${
                periodFilter === option.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant/25 bg-surface-container-lowest text-on-surface hover:border-primary/30'
              }`}
            >
              <span className="block japanese-text">{option.label}</span>
              <span className={`mt-1 block text-[11px] font-bold ${periodFilter === option.value ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                {option.helper}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-full bg-primary text-on-primary">
              <span className="material-symbols-outlined" aria-hidden="true">database</span>
            </span>
            <div>
              <h3 className="text-lg font-extrabold text-on-surface japanese-text">{availabilityTitle}</h3>
              <p className="mt-1 text-sm text-on-surface-variant japanese-text">データソース: {setupState?.datasetId || 'GA4データセット未設定'}</p>
            </div>
          </div>
          <span className={`rounded-lg px-3 py-1 text-xs font-black ${availabilityTone}`}>
            {availabilityLabel}
          </span>
        </div>
        <div className="rounded-xl border border-primary/15 bg-primary/[0.045] p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-full bg-surface-container-lowest text-primary ring-1 ring-primary/20">
              <span className="material-symbols-outlined" aria-hidden="true">terminal</span>
            </span>
            <div>
              <h3 className="text-lg font-extrabold text-on-surface japanese-text">Python集計済み</h3>
              <p className="mt-1 text-sm text-on-surface-variant japanese-text">
                {isFallback ? 'レポート本文またはグラフの再取得が必要です' : 'BigQueryからPythonで集計しています'}
              </p>
            </div>
          </div>
          <span className="text-right text-xs font-bold text-on-surface-variant">最終更新:<br />{generatedAt}</span>
        </div>
      </div>

      <div className="rounded-xl border border-primary/15 bg-primary/[0.055] px-4 py-3 flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm font-bold text-primary japanese-text">
          <span className="material-symbols-outlined text-lg" aria-hidden="true">info</span>
          {availabilityMessage}
        </p>
        <button
          type="button"
          onClick={onScrollToGraphs}
          className="hidden md:inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-surface-container-lowest px-3 py-2 text-xs font-bold text-primary hover:bg-primary/[0.06]"
        >
          集計の詳細を見る
          <span className="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-full bg-primary/[0.08] text-primary">
                <span className="material-symbols-outlined" aria-hidden="true">{metric.icon}</span>
              </span>
              <span className="material-symbols-outlined text-base text-outline-variant" aria-hidden="true">help</span>
            </div>
            <h3 className="mt-4 text-sm font-extrabold text-on-surface japanese-text">{metric.label}</h3>
            <p className="mt-2 text-3xl font-black tabular-nums text-primary">{metric.value}</p>
            <p className={`mt-3 text-sm font-bold ${metric.tone === 'up' ? 'text-emerald-700' : 'text-on-surface-variant'}`}>{metric.delta}</p>
          </article>
        ))}
      </div>

      <div className="rounded-xl border border-amber-300/50 bg-amber-50/60 px-6 py-5">
        <div className="flex gap-4">
          <span className="material-symbols-outlined text-3xl text-amber-600" aria-hidden="true">lightbulb</span>
          <div>
            <h3 className="text-base font-extrabold text-on-surface japanese-text">まず確認する数値</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7 text-on-surface japanese-text">
              <li>まずGA4で取得済みのPV、セッション、CVイベント、LP別直帰率を確認します</li>
              <li>CPA、ROAS、CTR、広告費は媒体費Excelや広告管理画面がある場合だけ確定値として扱います</li>
              <li>未取得KPIは断定せず、追加取得の条件と見るべき指標を分けて判断します</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Reading board for Python/BigQuery generated chart bundles ── */
function GraphReadingBoard({
  themes,
  filteredGroups,
  topInsights,
  activeScopeLabel,
  setupState,
  onThemeChange,
  onScrollToGraphs,
}) {
  const themeSummaries = themes.map((theme) => ({
    ...theme,
    summary: computeThemeSummary(theme.groups),
  }))
  const featuredThemes = ['cv', 'traffic', 'lp', 'anomaly']
    .map((id) => themeSummaries.find((theme) => theme.id === id))
    .filter(Boolean)
  const totalCritical = themeSummaries.reduce((sum, theme) => sum + theme.summary.criticalShifts, 0)

  return (
    <section className="rounded-[1.35rem] bg-surface-container-lowest border border-outline-variant/20 shadow-sm overflow-hidden">
      <div className="flex flex-col justify-between gap-6 border-b border-outline-variant/15 bg-primary/[0.035] p-5 sm:p-7 xl:flex-row xl:items-end">
        <div className="space-y-3 max-w-3xl">
          <span className="inline-flex items-center gap-2 text-[11px] font-black tracking-[0.14em] uppercase text-primary">
            <span className="material-symbols-outlined text-base" aria-hidden="true">analytics</span>
            グラフ優先分析ボード
          </span>
          <div>
            <h2 className="text-2xl font-extrabold text-primary japanese-text">Pythonで集計したグラフを先に読む</h2>
            <p className="mt-2 text-sm leading-7 text-on-surface-variant japanese-text">
              GA4/BigQuery連携済みの数値を、CV・流入・LP・異常検知の順に確認します。AI考察は右カラムで「このグラフから何が言えるか」を質問する位置づけです。
            </p>
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:gap-3 xl:w-auto xl:min-w-[360px]">
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[10px] font-black text-on-surface-variant tracking-widest">表示グループ数</p>
            <strong className="text-2xl text-primary tabular-nums">{filteredGroups.length}</strong>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[10px] font-black text-on-surface-variant tracking-widest">テーマ数</p>
            <strong className="text-2xl text-primary tabular-nums">{themes.length}</strong>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[10px] font-black text-on-surface-variant tracking-widest">注意点</p>
            <strong className="text-2xl text-primary tabular-nums">{totalCritical}</strong>
          </div>
        </div>
      </div>

      <div className="p-7 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-7">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { id: 'cv', step: '01', title: 'CVイベント推移', body: 'CV数と取得済み母数を先に確認', icon: 'conversion_path' },
              { id: 'traffic', step: '02', title: '流入チャネル', body: 'チャネル別の勝ち筋と悪化源を分ける', icon: 'swap_horiz' },
              { id: 'lp', step: '03', title: 'LPの行動', body: 'ページ別の離脱・回遊・成果を確認', icon: 'web' },
              { id: 'anomaly', step: '04', title: '生データと異常', body: '急変値はテーブルで根拠まで見る', icon: 'warning' },
            ].map((step) => {
              const theme = themeSummaries.find((item) => item.id === step.id)
              const disabled = !theme
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!theme) return
                    onThemeChange(step.id)
                    onScrollToGraphs()
                  }}
                  className={`text-left rounded-2xl p-5 border transition-all min-h-[172px] ${
                    disabled
                      ? 'border-outline-variant/15 bg-surface-container-low text-on-surface-variant/40 cursor-not-allowed'
                      : 'border-primary/15 bg-surface-container-low hover:bg-primary/[0.055] hover:border-primary/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-black text-primary">{step.step}</span>
                    <span className="material-symbols-outlined text-primary" aria-hidden="true">{step.icon}</span>
                  </div>
                  <h3 className="mt-5 text-base font-extrabold text-on-surface japanese-text">{step.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-on-surface-variant japanese-text">{step.body}</p>
                  <p className="mt-4 text-[11px] font-black text-primary tabular-nums">
                    {theme ? `${theme.groups.length}グラフ / 注意${theme.summary.criticalShifts}件` : 'データなし'}
                  </p>
                </button>
              )
            })}
          </div>

          {featuredThemes.length > 0 && (
            <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="text-sm font-extrabold text-primary japanese-text">グラフ量の見取り図</h3>
                <span className="text-[11px] font-bold text-on-surface-variant">{activeScopeLabel}</span>
              </div>
              <div className="space-y-3">
                {featuredThemes.map((theme) => {
                  const width = Math.max(12, Math.round((theme.groups.length / Math.max(1, filteredGroups.length)) * 100))
                  return (
                    <div key={theme.id} className="grid grid-cols-[100px_minmax(0,1fr)_58px] gap-3 items-center">
                      <span className="text-xs font-bold text-on-surface-variant japanese-text">{theme.label}</span>
                      <span className="h-3 rounded-full bg-surface-container-high overflow-hidden">
                        <i className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </span>
                      <strong className="text-xs text-primary text-right tabular-nums">{theme.groups.length}件</strong>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-5 space-y-5">
          <div>
            <h3 className="text-sm font-extrabold text-primary japanese-text">AIに聞く前の前提</h3>
            <p className="mt-2 text-xs leading-6 text-on-surface-variant japanese-text">
              期間とデータセットを固定してから質問すると、AI回答がグラフ根拠に寄りやすくなります。
            </p>
          </div>
          <div className="space-y-2">
            <span className="flex items-center justify-between rounded-xl bg-surface-container-lowest px-3 py-2 text-xs">
              <b className="text-on-surface-variant">GA4保存先ID</b>
              <strong className="text-primary truncate max-w-[150px]">{setupState?.datasetId || '設定確認'}</strong>
            </span>
            <span className="flex items-center justify-between rounded-xl bg-surface-container-lowest px-3 py-2 text-xs">
              <b className="text-on-surface-variant">対象期間</b>
              <strong className="text-primary">{activeScopeLabel}</strong>
            </span>
          </div>
          {topInsights.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-black text-on-surface-variant tracking-widest">質問候補</p>
              {topInsights.slice(0, 3).map((insight) => (
                <p key={insight.evidenceId} className="rounded-xl bg-surface-container-lowest px-3 py-2 text-xs leading-6 text-on-surface japanese-text">
                  {insight.title} の変化は、どの施策に影響していますか？
                </p>
              ))}
            </div>
          )}
          <a
            href="/insights/ai"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-on-primary hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">chat</span>
            AI考察で質問する
          </a>
        </aside>
      </div>
    </section>
  )
}

function GraphAiQuestionRail({
  topInsights,
  themes,
  activeScopeLabel,
  setupState,
  reportBundle,
  scopedChartGroups,
  isAdsAuthenticated,
  analysisKey,
  analysisProvider,
  currentCase,
  onThemeChange,
  onScrollToGraphs,
  isCollapsed,
  onToggleCollapsed,
}) {
  const [inlineQuestion, setInlineQuestion] = useState('')
  const [inlineAnswer, setInlineAnswer] = useState('')
  const [inlineReport, setInlineReport] = useState(null)
  const [inlineAgentTrace, setInlineAgentTrace] = useState([])
  const [inlineStatus, setInlineStatus] = useState('')
  const [inlineLoading, setInlineLoading] = useState(false)
  const prompts = topInsights.length > 0
    ? topInsights.slice(0, 4).map((insight) => `${insight.title} の変化を、広告運用ではどう読むべき？`)
    : [
        'CVイベントが減った場合、どのグラフから確認すべき？',
        'CPAを判断するには、追加でどの媒体データが必要？',
        '今週優先して見るべき数値を3つに絞って',
        '異常値が施策判断に影響するか確認したい',
      ]
  const selectedQuestion = inlineQuestion.trim() || prompts[0] || ''
  const wideAiHref = `/insights/ai?question=${encodeURIComponent(selectedQuestion)}`

  if (isCollapsed) {
    return (
      <aside
        data-testid="ads-graph-ai-rail"
        data-state="collapsed"
        className="fixed right-4 top-24 z-20 hidden lg:block xl:right-6"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="AIグラフチャットを開く"
          title="AIグラフチャットを開く"
          className="flex min-h-24 w-12 flex-col items-center justify-start gap-3 rounded-[1.35rem] border border-primary/15 bg-surface-container-lowest px-2.5 py-4 text-primary shadow-sm transition hover:bg-primary/[0.045]"
        >
          <span className="grid size-10 place-items-center rounded-full bg-primary text-on-primary">
            <span className="material-symbols-outlined text-lg" aria-hidden="true">forum</span>
          </span>
          <span className="text-[10px] font-black tracking-[0.14em] [writing-mode:vertical-rl]">AIチャット</span>
          <span className="material-symbols-outlined text-base" aria-hidden="true">left_panel_open</span>
        </button>
      </aside>
    )
  }

  async function handleInlineAsk(text) {
    const prompt = (text ?? inlineQuestion).trim()
    if (!prompt) {
      setInlineStatus('質問を入力してください。')
      return
    }
    if (!isAdsAuthenticated) {
      setInlineStatus('考察スタジオへのログインが必要です。')
      return
    }
    if (!reportBundle?.reportMd) {
      setInlineStatus('先に分析データを取得してください。')
      return
    }

    setInlineLoading(true)
    setInlineStatus('右カラムで考察中…')
    setInlineAnswer('')
    setInlineReport(null)
    setInlineAgentTrace([])
    try {
      const inlineEvidenceGroups = pickInlineQuestionGroups(
        prompt,
        reportBundle?.chartGroups ?? [],
        scopedChartGroups ?? [],
      )
      const hasPromptMatchedScope =
        inlineEvidenceGroups.length > 0 &&
        inlineEvidenceGroups.length !== (scopedChartGroups?.length ?? 0)
      const inlineScopeLabel = hasPromptMatchedScope
        ? `質問に一致: ${inlineEvidenceGroups[0]?.title || '関連グラフ'}`
        : (activeScopeLabel || '広告グラフ 表示中')
      const inlineEvidencePack = buildChartEvidencePack(inlineEvidenceGroups, {
        scopeLabel: inlineScopeLabel,
        maxCharts: 12,
      })
      const analysisInstructions = buildAnalysisInstructions(
        setupState?.queryTypes ?? [],
        setupState?.periods ?? [],
      )
      const payload = {
        mode: 'question',
        model: getAnalysisModel(analysisProvider) || 'claude-sonnet-4-20250514',
        provider: analysisProvider || 'anthropic',
        temperature: 0.3,
        message: [
          analysisInstructions,
          GRAPH_AI_HTML_REPORT_INSTRUCTIONS,
          `対象期間: ${activeScopeLabel}`,
          `根拠範囲: ${inlineScopeLabel}`,
          `右カラムのグラフ確認中の質問です。回答は広告運用者向けに、根拠グラフ・読むべき指標・次の一手を短く示してください。`,
          `---\n${prompt}`,
        ].filter(Boolean).join('\n\n'),
        user_prompt: prompt,
        point_pack_md: extractMarkdownSummary(reportBundle.reportMd) || reportBundle.reportMd,
        style_reference: '',
        style_preset: 'mixed',
        data_source: 'bq',
        data_availability: reportBundle?.dataAvailability || (reportBundle?.source === 'bq_generate_fallback' ? 'fallback' : 'full'),
        missing_reason: reportBundle?.missingReason || '',
        bq_query_types: setupState?.queryTypes ?? [],
        conversation_history: [],
        workflow: 'multi_agent_v1',
        report_contract_version: 'insight_report_v2',
        ai_chart_context: buildAiChartContext(inlineEvidenceGroups),
        analysis_context_meta: {
          projectName: currentCase?.name,
          caseName: currentCase?.name,
          propertyName: setupState?.propertyName,
          datasetId: setupState?.datasetId,
          periods: setupState?.periods ?? [],
          queryTypes: setupState?.queryTypes ?? [],
        },
        chart_evidence_pack: inlineEvidencePack,
        beginner_report: reportBundle?.beginnerReport ?? null,
        active_chart_scope: {
          label: inlineScopeLabel,
          chart_ids: inlineEvidencePack?.charts?.map((chart) => chart.chart_id) ?? [],
        },
        session_policy: {
          turn_index: 1,
          keep_full_context_until_turn: 5,
          date_alias_handling: '20260130 / 2026-01-30 / 2026年1月30日 / 1/30 を同じ日として扱う',
        },
      }
      const data = await neonGenerate(payload, analysisKey)
      const normalized = normalizeAdsPayload(data)
      const baseText = getAdsText(data) ?? getAdsText(normalized)
      const report = extractInsightReport(baseText)
      const meta = extractInsightMeta(baseText)
      const cleanedBaseText = stripInsightJsonFences(baseText)
      const text = cleanedBaseText || (report ? '構造化AI考察を表示します。' : '')
      if (!text && !report) throw new Error('AI応答本文を取得できませんでした。')
      setInlineReport(report)
      setInlineAgentTrace(data?.agent_trace ?? normalized?.agent_trace ?? report?.agent_trace ?? meta?.agent_trace ?? [])
      setInlineAnswer(text)
      setInlineStatus('右カラムで回答しました。広い画面で続ける場合はAI考察を開けます。')
    } catch (e) {
      const message = e?.isAuthError ? AUTH_EXPIRED_MESSAGE : (e?.message || 'AI考察の生成に失敗しました。')
      setInlineStatus(message)
    } finally {
      setInlineLoading(false)
    }
  }

  return (
    <aside
      data-testid="ads-graph-ai-rail"
      className="fixed right-4 top-20 z-20 hidden w-[min(360px,calc(100vw-2rem))] max-h-[calc(100vh-6rem)] self-start overflow-y-auto overscroll-contain rounded-[1.35rem] border border-primary/15 bg-surface-container-lowest shadow-sm lg:block xl:right-6 xl:top-24 xl:max-h-[calc(100vh-7rem)]"
    >
      <div className="p-5 border-b border-outline-variant/15 bg-primary/[0.045]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.14em] text-primary">AIグラフチャット</p>
            <h2 className="mt-1 text-lg font-extrabold text-primary japanese-text">グラフを見ながら質問</h2>
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="AIグラフチャットを閉じる"
            title="AIグラフチャットを閉じる"
            className="grid size-10 place-items-center rounded-full bg-primary text-on-primary transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">right_panel_close</span>
          </button>
        </div>
        <p className="mt-3 text-xs leading-6 text-on-surface-variant japanese-text">
          右カラムは考察専用です。期間とGA4保存先を固定したまま、気になったグラフの読み解きをAIに聞きます。
        </p>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-2 text-xs">
          <span className="flex items-center justify-between rounded-xl bg-surface-container-low px-3 py-2">
            <b className="text-on-surface-variant">対象期間</b>
            <strong className="text-primary text-right">{activeScopeLabel}</strong>
          </span>
          <span className="flex items-center justify-between rounded-xl bg-surface-container-low px-3 py-2">
            <b className="text-on-surface-variant">GA4保存先ID</b>
            <strong className="text-primary truncate max-w-[170px]">{setupState?.datasetId || '未設定'}</strong>
          </span>
        </div>

        {themes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-black text-on-surface-variant tracking-widest">見るグラフを切替</p>
            <div className="grid grid-cols-2 gap-2">
              {themes.slice(0, 6).map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => {
                    onThemeChange(theme.id)
                    onScrollToGraphs()
                  }}
                  className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-left text-xs font-bold text-on-surface hover:border-primary/30 hover:text-primary transition-colors japanese-text"
                >
                  <span className="material-symbols-outlined mr-1 align-[-3px] text-sm" aria-hidden="true">{theme.icon}</span>
                  {theme.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-black text-on-surface-variant tracking-widest">質問例</p>
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setInlineQuestion(prompt)}
              className="block w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-left text-xs leading-6 text-on-surface hover:border-primary/30 hover:bg-primary/[0.035] transition-colors japanese-text"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-surface-container-low p-3">
          <label htmlFor="graph-ai-draft" className="text-[11px] font-black text-on-surface-variant tracking-widest">
            質問メモ
          </label>
          <textarea
            id="graph-ai-draft"
            className="mt-2 min-h-28 w-full resize-none rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 text-xs leading-6 text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-secondary japanese-text"
            placeholder="例: LP別セッションとCVイベントを見て、次に確認すべき追加データを知りたい"
            value={inlineQuestion}
            onChange={(e) => setInlineQuestion(e.target.value)}
          />
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => handleInlineAsk()}
              disabled={inlineLoading || !inlineQuestion.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-on-primary hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">{inlineLoading ? 'hourglass_top' : 'forum'}</span>
              {inlineLoading ? '右カラムで考察中…' : '右カラムで質問する'}
            </button>
            <a
              href={wideAiHref}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-primary/20 bg-surface-container-lowest px-4 py-3 text-sm font-bold text-primary hover:bg-primary/[0.04] transition-colors"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
              広いAI考察で開く
            </a>
          </div>
          {inlineStatus && (
            <p className="mt-3 rounded-xl bg-surface-container-lowest px-3 py-2 text-xs leading-6 text-on-surface-variant japanese-text">
              {inlineStatus}
            </p>
          )}
          {inlineAnswer && (
            <GraphInlineAnswer answer={inlineAnswer} report={inlineReport} agentTrace={inlineAgentTrace} />
          )}
        </div>
      </div>
    </aside>
  )
}

function GraphInlineAnswer({ answer, report: providedReport, agentTrace = [] }) {
  const report = providedReport ?? extractInsightReport(answer)
  const trace = agentTrace.length > 0 ? agentTrace : report?.agent_trace
  const renderContent = report?._strippedMarkdown ?? answer

  return (
    <div
      className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-primary/15 bg-surface-container-lowest p-3 text-xs leading-6 text-on-surface japanese-text"
      data-testid="graph-ai-inline-answer"
    >
      {report ? (
        <>
          <InlineStructuredReport report={report} markdown={renderContent} />
          <InlineAgentTracePanel trace={trace} />
        </>
      ) : (
        <>
          <MarkdownRenderer content={answer} variant="ai-insight" size="normal" />
          <InlineAgentTracePanel trace={trace} />
        </>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   Main Component: 広告分析 (Unified Analysis Surface)
   ════════════════════════════════════════════════════════ */
export default function AnalysisGraphs() {
  const navigate = useNavigate()
  const {
    isAdsAuthenticated,
    analysisKey,
    analysisProvider,
  } = useAuth()
  const { setupState, reportBundle, setReportBundle, resetSetup, currentCase } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')
  const [activeTheme, setActiveTheme] = useState('all')
  const [viewMode, setViewMode] = useState('analyst')
  const [openSections, setOpenSections] = useState({})
  const [activeSection, setActiveSection] = useState('graphs')
  const [creativeFilter, setCreativeFilter] = useState('all')
  const [isAiRailCollapsed, setIsAiRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const saved = window.localStorage.getItem(AI_RAIL_COLLAPSED_STORAGE_KEY)
      if (saved == null) return true
      return saved !== 'false'
    } catch {
      return true
    }
  })

  /* ── Excel import state ── */
  const [excelState, setExcelState] = useState('none')
  const [excelPreview, setExcelPreview] = useState(null)
  const [excelImport, setExcelImport] = useState(null)
  const [excelError, setExcelError] = useState(null)

  /* ── Data fetch ── */
  useEffect(() => {
    if (!setupState || !isAdsAuthenticated) return
    if (reportBundle?.source === 'bq_generate_batch') return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const nextBundle = await regenerateAdsReportBundle(setupState)
        if (!cancelled) setReportBundle(nextBundle)
      } catch (e) {
        if (!cancelled) setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  /* ── Chart data ── */
  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(() => getChartPeriodTags(chartGroups), [chartGroups])

  useEffect(() => {
    if (periodTags.length === 0) return
    if (periodFilter === 'all' || periodFilter === 'latest') return
    if (!periodTags.includes(periodFilter)) setPeriodFilter('latest')
  }, [periodFilter, periodTags])

  const filteredGroups = useMemo(() => {
    return getDisplayChartGroups(chartGroups, periodFilter)
  }, [chartGroups, periodFilter])

  const themes = useMemo(() => groupChartsByTheme(filteredGroups), [filteredGroups])
  const displayThemes = useMemo(() => {
    if (activeTheme === 'all') return themes
    return themes.filter((t) => t.id === activeTheme)
  }, [themes, activeTheme])

  const topInsights = useMemo(() => extractTopInsights(filteredGroups), [filteredGroups])
  const keyCharts = useMemo(() => pickKeyCharts(filteredGroups), [filteredGroups])

  /* ── Summary data (from EssentialPack extractors) ── */
  const currentReport = useMemo(() => reportBundle?.reportMd ?? '', [reportBundle?.reportMd])
  const dataAvailability = reportBundle?.dataAvailability || (reportBundle?.source === 'bq_generate_fallback' ? 'fallback' : 'full')
  const isPartialReport = dataAvailability === 'partial'
  const isFailedReport = dataAvailability === 'failed'
  const isFallbackReport = dataAvailability === 'fallback' || reportBundle?.source === 'bq_generate_fallback'
  const reportAvailabilityLabel = isFailedReport
    ? 'BQ取得失敗'
    : isFallbackReport
      ? '暫定表示'
      : isPartialReport
        ? 'BQ一部未取得'
        : reportBundle?.source === 'bq_generate_batch'
          ? 'BQ取得済み'
          : '暫定'
  const reportAvailabilityClass = isFailedReport || isPartialReport || isFallbackReport
    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
    : 'bg-primary-container text-on-primary-container'
  const executiveCards = useMemo(
    () => extractExecutiveCards(currentReport, chartGroups),
    [currentReport, chartGroups],
  )
  const refinedInsights = useMemo(() => extractRefinedInsights(currentReport), [currentReport])
  const qualityAlerts = useMemo(
    () => extractDataQualityAlerts(currentReport, chartGroups),
    [currentReport, chartGroups],
  )

  /* ── Creative refs ── */
  const creativeRefs = useMemo(() => excelImport?.creativeRefs ?? [], [excelImport?.creativeRefs])
  const textAds = useMemo(() => creativeRefs.filter((r) => !r.imageUrl), [creativeRefs])
  const bannerAds = useMemo(() => creativeRefs.filter((r) => r.imageUrl), [creativeRefs])
  const filteredCreatives = useMemo(() => {
    if (creativeFilter === 'text') return textAds
    if (creativeFilter === 'banner') return bannerAds
    return creativeRefs
  }, [creativeFilter, creativeRefs, textAds, bannerAds])

  /* ── Refined insights for detail report ── */
  const observations = useMemo(() => refinedInsights.filter((b) => b.type === 'observation'), [refinedInsights])
  const hypotheses = useMemo(() => refinedInsights.filter((b) => b.type === 'hypothesis'), [refinedInsights])
  const actions = useMemo(() => refinedInsights.filter((b) => b.type === 'action'), [refinedInsights])

  /* ── Accordion state for analyst themes ── */
  useEffect(() => {
    setOpenSections((current) => {
      const next = {}
      for (const theme of themes) next[theme.id] = current[theme.id] ?? true
      return next
    })
  }, [themes])

  const toggleSection = useCallback((themeId) => {
    setOpenSections((prev) => ({ ...prev, [themeId]: !prev[themeId] }))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(AI_RAIL_COLLAPSED_STORAGE_KEY, String(isAiRailCollapsed))
    } catch {
      // localStorageが使えない環境では、この画面内だけの開閉状態として扱います。
    }
  }, [isAiRailCollapsed])

  /* ── Header data ── */
  const periods = setupState?.periods ?? []
  const dateRange = periods.length > 0
    ? periods.length === 1 ? periods[0] : `${periods[0]} 〜 ${periods[periods.length - 1]}`
    : null

  const activeScopeLabel =
    periodFilter === 'all' ? '全期間まとめ'
    : periodFilter === 'latest' ? `最新期間: ${periodTags[periodTags.length - 1] ?? '-'}`
    : `対象期間: ${periodFilter}`

  const hasGraphData = filteredGroups.length > 0
  const hasCreativeData = creativeRefs.length > 0
  const hasDetailReport = refinedInsights.length > 0
  const visibleSections = useMemo(() => SECTIONS.filter((section) => {
    if (section.id === 'creative') return hasCreativeData
    if (section.id === 'detail-report') return hasDetailReport
    return true
  }), [hasCreativeData, hasDetailReport])
  const adsRailStatus = loading ? '取得中' : isFallbackReport ? '暫定' : hasGraphData ? 'グラフ表示中' : 'データ待ち'
  const graphsLayoutClassName = hasGraphData
    ? isAiRailCollapsed
      ? 'space-y-10'
      : 'space-y-10 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-8 xl:space-y-0'
    : ''

  /* ── Handlers ── */
  async function handleRefresh() {
    if (!setupState || !isAdsAuthenticated || loading) return
    setLoading(true)
    setError(null)
    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
    } catch (e) {
      setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleChangeSetup() {
    resetSetup()
    navigate('/ads/wizard', { state: { resetAt: Date.now() } })
  }

  async function handleExcelFile(file) {
    if (!file || !file.name.endsWith('.xlsx')) {
      setExcelError('対応形式は .xlsx のみです')
      return
    }
    setExcelState('uploading')
    setExcelError(null)
    try {
      const result = await parseExcelFile(file)
      setExcelPreview(result)
      setExcelState('preview')
    } catch (e) {
      setExcelError(e.message)
      setExcelState('none')
    }
  }

  function handleExcelApply() {
    if (!excelPreview) return
    setExcelImport(excelPreview)
    setExcelPreview(null)
    setExcelState('applied')
  }

  function handleExcelCancel() {
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function handleExcelRemove() {
    setExcelImport(null)
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function handleExcelReupload() {
    setExcelImport(null)
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function scrollToSection(sectionId) {
    setActiveSection(sectionId)
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-w-0 flex-1 overflow-x-hidden">
      <div className="max-w-[1680px] space-y-8 px-4 py-5 pb-20 sm:px-6 lg:space-y-10 lg:px-8 lg:py-8">

        {/* ═══ 1. PAGE HEADER ═══ */}
        <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {reportBundle?.source && (
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${reportAvailabilityClass}`}>
                  {reportAvailabilityLabel}
                </span>
              )}
              <h1 className="text-2xl font-extrabold tracking-tight text-primary japanese-text sm:text-3xl">詳細グラフ</h1>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-on-surface-variant text-sm">
              {setupState?.datasetId && (
                <span className="flex min-w-0 items-center gap-1 font-medium">
                  <span className="material-symbols-outlined text-base">corporate_fare</span>
                  <span className="max-w-[240px] truncate sm:max-w-none">{setupState.datasetId}</span>
                </span>
              )}
              {dateRange && (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">calendar_month</span>
                  {dateRange}
                </span>
              )}
              {reportBundle?.generatedAt && (
                <span className="flex items-center gap-1 text-[11px] opacity-60">
                  最終更新: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
                </span>
              )}
            </div>
            {/* Source chips */}
            <div className="flex gap-2 pt-1">
              <SourceBadge source="ga4" />
              {excelState === 'applied' && <SourceBadge source="excel" />}
            </div>
          </div>

          {/* Exec / Analyst toggle + refresh */}
          <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
            <Link
              to="/ads/report"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-colors hover:opacity-90"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">summarize</span>
              初心者レポート
            </Link>

            <div className="flex items-center justify-center rounded-full bg-surface-container p-1 ghost-border sm:w-auto">
              <button
                onClick={() => setViewMode('exec')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                  viewMode === 'exec'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                要約表示
              </button>
              <button
                onClick={() => setViewMode('analyst')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                  viewMode === 'analyst'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                詳細表示
              </button>
            </div>

            <button
              type="button"
              onClick={handleChangeSetup}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-surface-container-lowest px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/[0.05]"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">tune</span>
              セットアップ（クエリ・期間）
            </button>

            {/* Period selector */}
            {periodTags.length > 0 && (
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="w-full cursor-pointer rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant sm:w-auto"
              >
                <option value="latest">最新期間</option>
                <option value="all">全期間まとめ</option>
                {periodTags.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>
            )}

            <button
              onClick={handleRefresh}
              disabled={loading || !isAdsAuthenticated || !setupState}
              className="flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-primary transition-all hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base">refresh</span>}
              再取得
            </button>
          </div>
        </section>

        {/* ═══ 2. SOURCE / WARNING STRIP ═══ */}
        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}
        {excelError && (
          <div className="bg-error/5 border border-error/20 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-lg">error</span>
            <p className="text-sm text-on-surface">{excelError}</p>
            <button onClick={() => setExcelError(null)} className="ml-auto text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {excelState === 'applied' && excelImport?.warnings?.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-primary-container/5 border border-primary-container/10 rounded-xl">
            <span className="material-symbols-outlined text-primary text-lg">lightbulb</span>
            <div className="text-sm text-on-surface japanese-text">
              {excelImport.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          </div>
        )}

        {/* Excel import states */}
        {excelState === 'applied' && (
          <ExcelImportStatusStrip excelImport={excelImport} onReupload={handleExcelReupload} onRemove={handleExcelRemove} />
        )}
        {excelState === 'none' && (
          <ExcelImportBanner onFileSelected={handleExcelFile} disabled={loading} />
        )}
        {excelState === 'uploading' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 flex items-center gap-4">
            <LoadingSpinner size="md" label="Excelファイルを解析中…" />
          </div>
        )}
        {excelState === 'preview' && (
          <ExcelImportPreview result={excelPreview} onApply={handleExcelApply} onCancel={handleExcelCancel} />
        )}

        {/* ═══ 3. LOCAL SECTION NAV ═══ */}
        <nav className="flex gap-6 overflow-x-auto border-b border-outline-variant/15 pb-2">
          {visibleSections.map((sec) => (
            <button
              key={sec.id}
              onClick={() => scrollToSection(sec.id)}
              className={`relative py-2 text-sm font-medium transition-all ${
                activeSection === sec.id
                  ? 'text-primary font-semibold border-b-2 border-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {sec.label}
            </button>
          ))}
        </nav>

        {/* Data Quality Alert */}
        {qualityAlerts.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-warning-container border border-amber-200/50 dark:border-warning/30 text-on-surface rounded-xl">
            <span className="material-symbols-outlined text-xl text-amber-600 dark:text-warning">info</span>
            <p className="text-sm font-medium japanese-text">{qualityAlerts[0].message}</p>
          </div>
        )}

        {isFallbackReport && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-warning-container border border-amber-200/50 dark:border-warning/30 text-on-surface rounded-xl">
            <span className="material-symbols-outlined text-xl text-amber-600 dark:text-warning">pending</span>
            <p className="text-sm font-medium japanese-text">
              BigQueryレポート本文またはグラフが未取得のため、数値断定ではなく確認手順・追加取得候補を表示しています。
            </p>
          </div>
        )}

        {!hasGraphData && (
          <AiContextRail
            screenName="広告グラフAIレール"
            status={adsRailStatus}
            inputSummary={setupState?.datasetId || 'GA4データセット未設定'}
            evidence={['GA4 BigQuery', '取得状態', '追加クエリ', '未取得理由']}
            suggestedQuestions={[
              '今の未取得状態で、次に確認すべきクエリタイプを教えて',
              '数値断定せず、確認手順だけを整理して',
              'グラフ取得後に見るべき指標を優先順で出して',
            ]}
            primaryAction="広告グラフの未取得状態をAI考察で確認する"
            helperText="グラフが未取得の状態では、成功表示や数値断定を避け、取得条件と追加確認だけを整理します。"
          />
        )}

        {/* Loading state */}
        {loading && !currentReport && chartGroups.length === 0 && (
          <div className="bg-surface-container-lowest rounded-xl p-8 space-y-6">
            <LoadingSpinner size="md" label="分析データを取得中…" />
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        <div className={graphsLayoutClassName}>
          <div className="min-w-0 space-y-10">
            {/* ═══ 4. GRAPH SECTION ═══ */}
            <section id="section-graphs" className="scroll-mt-24 space-y-6">
              {hasGraphData ? (
                <>
                  {keyCharts.length > 0 && (
                    <div className="grid grid-cols-1 gap-8">
                      {keyCharts.map((group, idx) => (
                        <ChartGroupCard key={`key-${group.title ?? idx}`} group={{ ...group, defaultCollapsed: false }} featured />
                      ))}
                    </div>
                  )}

                  <ThemeTabs activeTheme={activeTheme} onThemeChange={setActiveTheme} themes={themes} />

                  <div className="space-y-6">
                    {displayThemes.map((theme) => (
                      <GraphSection
                        key={theme.id}
                        theme={theme}
                        isOpen={openSections[theme.id] ?? true}
                        onToggle={() => toggleSection(theme.id)}
                        viewMode={viewMode}
                      />
                    ))}

                    {(activeTheme === 'all' || activeTheme === 'anomaly') && (
                      <AnomalySection chartGroups={filteredGroups} />
                    )}
                  </div>

                  <QueryCoverageSummary
                    setupState={setupState}
                    reportBundle={reportBundle}
                    filteredGroups={filteredGroups}
                    periodLabel={activeScopeLabel}
                  />
                </>
              ) : !loading && (
                <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
                  <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
                  <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
                  <p className="text-sm text-on-surface-variant japanese-text">
                    セットアップでクエリと期間を選ぶと、BigQueryから取得したグラフがここに表示されます。
                  </p>
                  <button
                    type="button"
                    onClick={handleChangeSetup}
                    className="mx-auto inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary shadow-sm transition-all hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">settings_suggest</span>
                    セットアップでクエリ・期間を選ぶ
                  </button>
                </div>
              )}
            </section>
          </div>

          {hasGraphData && (
            <GraphAiQuestionRail
              topInsights={topInsights}
              themes={themes}
              activeScopeLabel={activeScopeLabel}
              setupState={setupState}
              reportBundle={reportBundle}
              scopedChartGroups={filteredGroups}
              isAdsAuthenticated={isAdsAuthenticated}
              analysisKey={analysisKey}
              analysisProvider={analysisProvider}
              currentCase={currentCase}
              onThemeChange={setActiveTheme}
              onScrollToGraphs={() => scrollToSection('graphs')}
              isCollapsed={isAiRailCollapsed}
              onToggleCollapsed={() => setIsAiRailCollapsed((current) => !current)}
            />
          )}
        </div>

        {/* ═══ 6. CREATIVE SECTION ═══ */}
        {hasCreativeData && (
          <section id="section-creative" className="scroll-mt-24 mt-16 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-primary japanese-text">クリエイティブ分析</h2>
              <div className="flex gap-2">
                {CREATIVE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setCreativeFilter(f.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      creativeFilter === f.id
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high border border-outline-variant/20'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredCreatives.slice(0, 9).map((ref, idx) =>
                ref.imageUrl
                  ? <BannerAdCard key={`banner-${idx}`} adRef={ref} index={idx} />
                  : <TextAdCard key={`text-${idx}`} adRef={ref} index={idx} />
              )}
            </div>
          </section>
        )}

        {/* ═══ 7. DETAILED REPORT SECTION ═══ */}
        {hasDetailReport && (
          <section id="section-detail-report" className="scroll-mt-24 mt-16 space-y-6">
            <div className="bg-surface-container-lowest p-8 rounded-xl ghost-border space-y-8">
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-primary text-3xl">description</span>
                <h2 className="text-xl font-extrabold text-primary japanese-text">詳細分析レポート</h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Fact */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">01</span>
                    <h3 className="text-base font-bold japanese-text">観測事実 (Fact)</h3>
                  </div>
                  <ul className="space-y-4">
                    {observations.length > 0 ? observations.map((obs, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="text-primary font-mono text-[10px] mt-1 shrink-0">{obs.evidenceId ?? `E-${String(idx + 1).padStart(2, '0')}`}</span>
                        <p className="text-sm leading-relaxed text-on-surface-variant japanese-text">{obs.summary}</p>
                      </li>
                    )) : (
                      <li className="text-xs text-on-surface-variant/50 italic">観測データなし</li>
                    )}
                  </ul>
                </div>

                {/* Inference */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-secondary font-bold text-xs">02</span>
                    <h3 className="text-base font-bold japanese-text">要因仮説 (Inference)</h3>
                  </div>
                  <ul className="space-y-4">
                    {hypotheses.length > 0 ? hypotheses.map((hyp, idx) => (
                      <li key={idx} className="space-y-1">
                        <p className="text-sm leading-relaxed text-on-surface-variant japanese-text">{hyp.summary}</p>
                        {hyp.source && (
                          <span className="px-2 py-0.5 bg-surface-container rounded text-[9px] text-on-surface-variant">出典: {hyp.source}</span>
                        )}
                      </li>
                    )) : (
                      <li className="text-xs text-on-surface-variant/50 italic">仮説未生成</li>
                    )}
                  </ul>
                </div>

                {/* Action */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold text-xs">03</span>
                    <h3 className="text-base font-bold japanese-text">推奨施策 (Action)</h3>
                  </div>
                  {actions.length > 0 ? (
                    <div className="p-4 bg-primary text-on-primary rounded-xl space-y-3 shadow-md">
                      {actions.map((act, idx) => (
                        <div key={idx} className={idx > 0 ? 'pt-3 border-t border-on-primary/10' : ''}>
                          <p className="text-sm font-semibold japanese-text">{act.summary}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-variant/50 italic">アクション未提案</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Empty state when no data at all */}
        {!loading && !error && !hasGraphData && excelState !== 'applied' && (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">analytics</span>
            <h3 className="text-xl font-bold japanese-text">分析データがまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              セットアップでクエリ・期間を選ぶか、上の「再取得」ボタンを押してデータを読み込んでください。
            </p>
            <button
              type="button"
              onClick={handleChangeSetup}
              className="mx-auto inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary shadow-sm transition-all hover:opacity-90"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">settings_suggest</span>
              セットアップでクエリ・期間を選ぶ
            </button>
          </div>
        )}
      </div>

      {/* ═══ EVIDENCE DRAWER ═══ */}
      {currentReport && executiveCards.length > 0 && (
        <EvidenceDrawer cards={executiveCards} reportBundle={reportBundle} />
      )}
    </div>
  )
}
