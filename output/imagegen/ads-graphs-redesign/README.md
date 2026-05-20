# /ads/graphs redesign mock adoption notes

Generated with the built-in Image Gen tool on 2026-05-20 as UI direction references only.
Production numbers, labels, legends, axes, warnings, and tables are rendered by React / Chart.js.

## Assets

- `lp-daily-trend-focus.png`: Adopt the focused-line composition: top 1-2 series are primary, remaining series become muted context / aggregate, with a side legend.
- `lp-bounce-flat-diagnostic.png`: Adopt the diagnostic replacement pattern for flat bounce-rate rankings.
- `search-low-sample-state.png`: Adopt the low-sample table-first state for search query trend charts.
- `ranking-top15-readable.png`: Adopt the readable horizontal ranking layout with all labels visible and top rows emphasized.
- `graph-card-collapsed-expanded-system.png`: Adopt the collapsed summary / expanded inspection split.

## Guardrails

- Do not use generated chart pixels as metric truth.
- Keep exact Japanese text, values, coverage labels, warnings, and data rows in DOM / Chart.js.
- Use the mocks for layout density, hierarchy, and legend placement only.
