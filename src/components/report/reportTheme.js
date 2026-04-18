/**
 * Botanical Green theme tokens + chart.js global defaults for report visualizations.
 * Shared across PriorityActionHero, CompetitorMatrix, MarketRangeBar, BrandRadarChart.
 */

export const REPORT_COLORS = {
  primary: '#003925',
  primaryContainer: '#0f5238',
  primaryFixed: '#b1f0ce',
  primaryFixedDim: '#95d4b3',
  secondary: '#456553',
  secondaryContainer: '#c4e8d1',
  accentGold: '#D4A843',
  accentGoldContainer: '#f5ecd4',
  surface: '#fafaf5',
  surfaceContainer: '#eeeee9',
  surfaceContainerLow: '#f4f4ef',
  surfaceContainerLowest: '#ffffff',
  outline: '#707973',
  outlineVariant: '#bfc9c1',
  success: '#2e7d32',
  warning: '#e65100',
  error: '#ba1a1a',
}

export const JUDGMENT_COLORS = {
  強:      { dot: '#2e7d32', bg: '#dcfce7', text: '#14532d', icon: 'trending_up' },
  同等:    { dot: '#D4A843', bg: '#fef3c7', text: '#78350f', icon: 'drag_handle' },
  弱:      { dot: '#ba1a1a', bg: '#fee2e2', text: '#7f1d1d', icon: 'trending_down' },
  評価保留: { dot: '#9ca3af', bg: '#f3f4f6', text: '#374151', icon: 'pending' },
}

/**
 * Primary heatmap gradient stops used by CompetitorMatrix cells.
 * Light → dark green, matching `--color-primary-fixed-dim` → `--color-primary`.
 */
export const HEATMAP_GRADIENT = ['#e7f6ed', '#b1f0ce', '#95d4b3', '#5aa383', '#0f5238', '#003925']

/**
 * Chart.js global defaults — call once at app bootstrap (or lazily per chart).
 * Keeping it idempotent so HMR re-runs don't stack handlers.
 */
export function applyChartDefaults(Chart) {
  if (!Chart?.defaults || Chart.defaults.__reportThemeApplied) return
  Chart.defaults.font.family = 'Manrope, system-ui, -apple-system, "Segoe UI", sans-serif'
  Chart.defaults.font.size = 12
  Chart.defaults.color = '#1a1c19'
  Chart.defaults.borderColor = REPORT_COLORS.outlineVariant
  Chart.defaults.animation = { duration: 400 }
  Chart.defaults.plugins = Chart.defaults.plugins || {}
  Chart.defaults.plugins.tooltip = {
    ...Chart.defaults.plugins.tooltip,
    backgroundColor: REPORT_COLORS.primary,
    titleColor: '#ffffff',
    bodyColor: '#ffffff',
    cornerRadius: 8,
    padding: 10,
  }
  Chart.defaults.plugins.legend = {
    ...Chart.defaults.plugins.legend,
    labels: { boxWidth: 12, boxHeight: 12, padding: 12 },
  }
  Chart.defaults.__reportThemeApplied = true
}
