/**
 * Stitch 2.0 (v2) report theme tokens + Chart.js defaults.
 *
 * Kept parallel to reportTheme.js (v1) so v1 consumers are untouched.
 * `applyChartDefaultsV2` snapshots prior defaults before writing so
 * `restoreChartDefaultsV2` can unwind when v2 components unmount.
 */

export const REPORT_COLORS_V2 = {
  primary: '#003925',
  primaryContainer: '#0f5238',
  primaryFixed: '#b1f0ce',
  primaryFixedDim: '#95d4b3',
  secondary: '#456553',
  secondaryContainer: '#c4e8d1',
  tertiary: '#d4a843',
  tertiaryContainer: '#f5ecd4',
  surface: '#fafaf5',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f4f4ef',
  surfaceContainer: '#eeeee9',
  surfaceContainerHigh: '#e8e8e3',
  outline: '#707973',
  outlineVariant: '#bfc9c1',
  onSurface: '#1a1c19',
  onSurfaceVariant: '#414843',
  success: '#2e7d32',
  warning: '#e65100',
  error: '#ba1a1a',
}

export const VERDICT_TOKENS_V2 = {
  強: {
    bg: REPORT_COLORS_V2.primaryContainer,
    fg: '#ffffff',
    symbol: '▲',
    label: '強',
  },
  同等: {
    bg: REPORT_COLORS_V2.secondaryContainer,
    fg: '#14532d',
    symbol: '＝',
    label: '同等',
  },
  弱: {
    bg: '#fee2e2',
    fg: '#7f1d1d',
    symbol: '▼',
    label: '弱',
  },
  評価保留: {
    bg: REPORT_COLORS_V2.surfaceContainer,
    fg: '#374151',
    symbol: '・',
    label: '評価保留',
  },
}

export const BRAND_PALETTE_V2 = [
  { border: '#003925', bg: 'rgba(0, 57, 37, 0.18)' },
  { border: '#d4a843', bg: 'rgba(212, 168, 67, 0.18)' },
  { border: '#456553', bg: 'rgba(69, 101, 83, 0.16)' },
  { border: '#ba1a1a', bg: 'rgba(186, 26, 26, 0.14)' },
  { border: '#78350f', bg: 'rgba(120, 53, 15, 0.14)' },
  { border: '#0f5238', bg: 'rgba(15, 82, 56, 0.18)' },
]

/**
 * Apply v2 defaults to a Chart.js instance. Idempotent — guarded by a flag.
 * Snapshots prior font/color/animation config so `restoreChartDefaultsV2`
 * can revert on unmount without stepping on v1.
 */
export function applyChartDefaultsV2(Chart) {
  if (!Chart?.defaults) return
  if (Chart.defaults.__reportThemeV2Applied) return

  Chart.defaults.__reportThemeV2Snapshot = {
    font: { ...Chart.defaults.font },
    color: Chart.defaults.color,
    borderColor: Chart.defaults.borderColor,
    animation: Chart.defaults.animation,
    tooltip: Chart.defaults.plugins?.tooltip ? { ...Chart.defaults.plugins.tooltip } : null,
    legend: Chart.defaults.plugins?.legend ? { ...Chart.defaults.plugins.legend } : null,
    reportThemeApplied: Chart.defaults.__reportThemeApplied,
  }

  Chart.defaults.font.family = 'Manrope, Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
  Chart.defaults.font.size = 12
  Chart.defaults.color = REPORT_COLORS_V2.onSurface
  Chart.defaults.borderColor = REPORT_COLORS_V2.outlineVariant
  Chart.defaults.animation = {
    duration: 300,
    easing: 'easeOutCubic',
  }
  Chart.defaults.plugins = Chart.defaults.plugins || {}
  Chart.defaults.plugins.tooltip = {
    ...Chart.defaults.plugins.tooltip,
    backgroundColor: REPORT_COLORS_V2.primary,
    titleColor: '#ffffff',
    bodyColor: '#ffffff',
    cornerRadius: 12,
    padding: 12,
    titleFont: { family: 'Manrope', weight: '700' },
  }
  Chart.defaults.plugins.legend = {
    ...Chart.defaults.plugins.legend,
    labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true },
  }
  Chart.defaults.__reportThemeV2Applied = true
}

export function restoreChartDefaultsV2(Chart) {
  if (!Chart?.defaults) return
  const snap = Chart.defaults.__reportThemeV2Snapshot
  if (!snap) return
  Chart.defaults.font = snap.font
  Chart.defaults.color = snap.color
  Chart.defaults.borderColor = snap.borderColor
  Chart.defaults.animation = snap.animation
  Chart.defaults.plugins = Chart.defaults.plugins || {}
  if (snap.tooltip) Chart.defaults.plugins.tooltip = snap.tooltip
  if (snap.legend) Chart.defaults.plugins.legend = snap.legend
  Chart.defaults.__reportThemeApplied = snap.reportThemeApplied
  delete Chart.defaults.__reportThemeV2Applied
  delete Chart.defaults.__reportThemeV2Snapshot
}
