import { useMemo } from 'react'
import { resolveChartPresentation } from '../../utils/chartTypeInference'
import { normalizeChartGroupShape } from '../../utils/adsReports'
import { analyzeChartReadability } from '../../utils/chartReadability'
import { buildSeries, getLabels } from '../../utils/chartSeriesTransform'
import AdsChartCardShell from './charts/AdsChartCardShell'
import AnomalyDetectionCard from './charts/AnomalyDetectionCard'
import ChartEmptyState from './charts/ChartEmptyState'
import CompositionDonutCard from './charts/CompositionDonutCard'
import DailyTrendCard from './charts/DailyTrendCard'
import FlatMetricDiagnosticCard from './charts/FlatMetricDiagnosticCard'
import HeatmapDataTableCard from './charts/HeatmapDataTableCard'
import LowSampleSearchCard from './charts/LowSampleSearchCard'
import MultiSeriesTrendCard from './charts/MultiSeriesTrendCard'
import RankingBarTableCard from './charts/RankingBarTableCard'
import SeriesSummaryBarCard from './charts/SeriesSummaryBarCard'
import SmallMultipleTrendCard from './charts/SmallMultipleTrendCard'

function isAnomalyScoreGroup(group) {
  const title = String(group?.title ?? '')
  const displayMode = String(group?.displayMode ?? group?.metadata?.displayMode ?? '')
  const datasetLabels = Array.isArray(group?.datasets)
    ? group.datasets.map((dataset) => dataset?.label).filter(Boolean).join(' ')
    : ''

  return displayMode === 'anomaly_zscore' ||
    /z[-_\s]?score|標準化スコア/i.test(`${title} ${datasetLabels}`)
}

function isDailyTrend(group, chartType) {
  const title = String(group?.title ?? '')
  return (chartType === 'line' || chartType === 'area') && /日別|推移|trend/i.test(title)
}

function isDateLikeLabel(label) {
  return /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{8})$/.test(String(label ?? '').trim())
}

function shouldUseHeatmapTable(group, chartType) {
  const explicitDisplayMode = group?.displayMode ?? group?.metadata?.displayMode
  if (explicitDisplayMode !== 'heatmap_table') return false

  const labels = getLabels(group)
  const series = buildSeries(group)
  const title = `${group?.title ?? ''} ${group?.coverageLabel ?? ''} ${group?.metadata?.coverageLabel ?? ''}`
  const dateLikeCount = labels.filter(isDateLikeLabel).length
  const hasMostlyDates = labels.length > 0 && dateLikeCount / labels.length >= 0.6
  const longRawList = labels.length >= 20 && series.length >= 3 && /raw|数値一覧|データ一覧/i.test(title)

  if (isDailyTrend(group, chartType)) return false
  if ((chartType === 'line' || chartType === 'area') && hasMostlyDates) return false
  if (longRawList) return true
  return false
}

function getCardMode(group, effectiveChartType, readability) {
  if (readability.recommendedDisplayMode === 'flat_diagnostic') return 'flat_diagnostic'
  if (readability.recommendedDisplayMode === 'low_sample_table') return 'low_sample'
  if (isAnomalyScoreGroup(group)) return 'anomaly'
  if (effectiveChartType === 'doughnut') return 'composition'
  if (shouldUseHeatmapTable(group, effectiveChartType)) return 'heatmap_table'
  if (effectiveChartType === 'bar_horizontal' || readability.recommendedDisplayMode === 'readable_ranking') return 'ranking'
  if (isDailyTrend(group, effectiveChartType) && buildSeries(group).length >= 3) return 'small_multiple_trend'
  if (isDailyTrend(group, effectiveChartType) && buildSeries(group).length > 1) return 'multi_trend'
  if (isDailyTrend(group, effectiveChartType)) return 'daily_trend'
  if (effectiveChartType === 'line' || effectiveChartType === 'area') return 'daily_trend'
  return 'ranking'
}

function getModeLabel(mode) {
  switch (mode) {
    case 'flat_diagnostic':
      return '同一値診断'
    case 'low_sample':
      return '低サンプル'
    case 'anomaly':
      return '急な変化'
    case 'ranking':
      return 'ランキング'
    case 'composition':
      return '構成比'
    case 'multi_trend':
      return '主系列を強調'
    case 'series_bar_summary':
      return '項目別サマリー'
    case 'heatmap_table':
      return 'データテーブル'
    case 'small_multiple_trend':
      return '系列別推移'
    case 'daily_trend':
      return '日別推移'
    default:
      return 'グラフ'
  }
}

function getModeMessage(mode) {
  switch (mode) {
    case 'flat_diagnostic':
      return '値が同一のため、棒グラフではなく診断と次アクションを表示します。'
    case 'low_sample':
      return 'データが少ないため、線で傾向を誇張せず、確認できた日と実際の件数を表示します。'
    case 'anomaly':
      return '標準化した変化量だけを使い、普段と違う動きの候補を1指標ずつ確認します。'
    case 'ranking':
      return '上位15件まで、ラベル・値・シェアを欠けずに確認できます。'
    case 'composition':
      return '色と項目の対応を固定し、ホバーなしで構成比を確認できます。'
    case 'multi_trend':
      return '一番見たい線・比較する線・補助線を分け、読む順番を固定しています。'
    case 'series_bar_summary':
      return '3系列以上は重ね折れ線を使わず、項目別の横棒で比較します。'
    case 'heatmap_table':
      return '日付や項目が多いため、グラフではなく色付きテーブルで値の大小を確認します。'
    case 'small_multiple_trend':
      return '3系列以上は重ねず、選択系列の大きな推移で形と値を読み分けます。'
    default:
      return '日別の変化を主指標から確認できます。'
  }
}

function renderBody(mode, group) {
  switch (mode) {
    case 'flat_diagnostic':
      return <FlatMetricDiagnosticCard group={group} />
    case 'low_sample':
      return <LowSampleSearchCard group={group} />
    case 'anomaly':
      return <AnomalyDetectionCard group={group} />
    case 'ranking':
      return <RankingBarTableCard group={group} />
    case 'composition':
      return <CompositionDonutCard group={group} />
    case 'multi_trend':
      return <MultiSeriesTrendCard group={group} />
    case 'series_bar_summary':
      return <SeriesSummaryBarCard group={group} />
    case 'heatmap_table':
      return <HeatmapDataTableCard group={group} />
    case 'small_multiple_trend':
      return <SmallMultipleTrendCard group={group} />
    case 'daily_trend':
      return <DailyTrendCard group={group} />
    default:
      return <RankingBarTableCard group={group} />
  }
}

export default function ChartGroupCard({ group, featured = false, compact = false }) {
  const normalizedGroup = useMemo(() => normalizeChartGroupShape(group ?? {}), [group])
  const presentation = useMemo(() => resolveChartPresentation(normalizedGroup), [normalizedGroup])
  const effectiveChartType = presentation.chartType
  const readability = useMemo(
    () => analyzeChartReadability(normalizedGroup, effectiveChartType),
    [normalizedGroup, effectiveChartType],
  )
  const series = useMemo(() => buildSeries(normalizedGroup), [normalizedGroup])
  const labels = getLabels(normalizedGroup)
  const hasRenderableData = series.length > 0 && labels.length > 0
  const mode = useMemo(
    () => getCardMode(normalizedGroup, effectiveChartType, readability),
    [normalizedGroup, effectiveChartType, readability],
  )

  const defaultCollapsed = Boolean(normalizedGroup?.defaultCollapsed)

  return (
    <AdsChartCardShell
      group={normalizedGroup}
      modeLabel={getModeLabel(mode)}
      message={getModeMessage(mode)}
      defaultCollapsed={defaultCollapsed}
      featured={featured}
      compact={compact}
    >
      {hasRenderableData ? renderBody(mode, normalizedGroup) : <ChartEmptyState />}
    </AdsChartCardShell>
  )
}
