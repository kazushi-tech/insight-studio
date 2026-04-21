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

export const REPORT_COLORS_DARK = {
  primary: '#95d4b3',
  primaryContainer: '#1a3a28',
  primaryFixed: '#1e4430',
  primaryFixedDim: '#2d5a42',
  secondary: '#95d4b3',
  secondaryContainer: '#2a4a38',
  accentGold: '#e8c46e',
  accentGoldContainer: '#3a3220',
  surface: '#0f1512',
  surfaceContainer: '#1a261e',
  surfaceContainerLow: '#141f18',
  surfaceContainerLowest: '#0b100d',
  outline: '#607068',
  outlineVariant: '#2e3f38',
  success: '#66bb6a',
  warning: '#ffb74d',
  error: '#ff8f8f',
}

export const JUDGMENT_COLORS = {
  強:      { dot: '#2e7d32', bg: '#dcfce7', text: '#14532d', icon: 'trending_up' },
  同等:    { dot: '#D4A843', bg: '#fef3c7', text: '#78350f', icon: 'drag_handle' },
  弱:      { dot: '#ba1a1a', bg: '#fee2e2', text: '#7f1d1d', icon: 'trending_down' },
  評価保留: { dot: '#9ca3af', bg: '#f3f4f6', text: '#374151', icon: 'pending' },
}

export const JUDGMENT_COLORS_DARK = {
  強:      { dot: '#66bb6a', bg: '#1a3a28', text: '#95d4b3', icon: 'trending_up' },
  同等:    { dot: '#e8c46e', bg: '#3a3220', text: '#e8c46e', icon: 'drag_handle' },
  弱:      { dot: '#ff8f8f', bg: '#5a2020', text: '#ff8f8f', icon: 'trending_down' },
  評価保留: { dot: '#607068', bg: '#243029', text: '#97a89d', icon: 'pending' },
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
function isDarkMode() {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.theme === 'dark'
}

function getActiveColors() {
  return isDarkMode() ? REPORT_COLORS_DARK : REPORT_COLORS
}

export function getActiveJudgmentColors() {
  return isDarkMode() ? JUDGMENT_COLORS_DARK : JUDGMENT_COLORS
}

export function applyChartDefaults(Chart) {
  if (!Chart?.defaults) return
  const currentTheme = isDarkMode() ? 'dark' : 'light'
  if (Chart.defaults.__reportThemeApplied && Chart.defaults.__reportThemeSnapshot?.theme === currentTheme) return
  if (Chart.defaults.__reportThemeApplied) {
    delete Chart.defaults.__reportThemeApplied
    delete Chart.defaults.__reportThemeSnapshot
  }
  const c = getActiveColors()
  Chart.defaults.font.family = 'Manrope, system-ui, -apple-system, "Segoe UI", sans-serif'
  Chart.defaults.font.size = 12
  Chart.defaults.color = c.onSurface ?? '#1a1c19'
  Chart.defaults.borderColor = c.outlineVariant
  Chart.defaults.animation = { duration: 400 }
  Chart.defaults.plugins = Chart.defaults.plugins || {}
  Chart.defaults.plugins.tooltip = {
    ...Chart.defaults.plugins.tooltip,
    backgroundColor: c.primaryContainer,
    titleColor: c.onSurface ?? '#ffffff',
    bodyColor: c.onSurface ?? '#ffffff',
    cornerRadius: 8,
    padding: 10,
  }
  Chart.defaults.plugins.legend = {
    ...Chart.defaults.plugins.legend,
    labels: { boxWidth: 12, boxHeight: 12, padding: 12 },
  }
  Chart.defaults.__reportThemeSnapshot = { theme: currentTheme }
  Chart.defaults.__reportThemeApplied = true
}
