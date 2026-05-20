# Review: ads graphs data quality implementation

Date: 2026-05-20

## Scope

- Backend chart coverage metadata and missing-label handling.
- Frontend chart group normalization, all-period merge safety, raw table missing-value display.
- `/ads/graphs` UI placement, plain card frame, collapsible long graph cards.
- Regression tests and right-column browser verification.

## Gates

### Plan Gate

PASS.

- The implementation follows the approved plan: metadata first, frontend contract normalization second, UI clarity third.
- GPT Image2 was not used for data graphs.

### Diff Gate

PASS.

- Ranking chart titles no longer use fixed `Top 20` style labels for search / LP / device OS / user_attr city / traffic ranking surfaces.
- Chart groups carry `queryType`, `limit`, `actualCount`, `sourceRowCount`, `coverageLabel`, `warnings`, and `missingLabelCount` where ranking semantics apply.
- Frontend normalizes label/data length mismatches, pads missing data with `null`, keeps overflow points with placeholder labels, and avoids merging ranking charts with incompatible labels across periods.
- Raw table display now uses explicit missing semantics instead of a bare `-`.
- Long chart cards can be collapsed and later reopened.

### Runtime Gate

PASS with known backend-suite caveat.

- `npm run lint`: PASS.
- `npm run build`: PASS, with existing bundle-size warning only.
- `npm test`: PASS, 38 files / 272 tests.
- Targeted backend pytest for changed BQ chart/reporter behavior: PASS, 14 tests.
- Full `backends/ads-insights/tests` collection is blocked by pre-existing missing local analyzer modules (`analyze`, `.agent/skills/*/analyze.py`, `temp_report_logic`), unrelated to this patch.

### Release Gate

PASS for local implementation and verification.

- Right-column browser opened `http://127.0.0.1:3002/ads/graphs`.
- Observed Python集計グラフ at the top of the graph view.
- Observed `上位N件 / 最大N件` coverage labels.
- Observed collapsible graph cards.
- Observed raw data table and explicit missing-warning text.
- Observed no `Top 20` fixed label and no `Python描画エリア` label in the inspected DOM.
- Opened adjacent `http://127.0.0.1:3002/ads/ai`; console/network error and warning logs were empty.

## Findings

None blocking.

## Residual Risk

- Full backend test suite still needs its historical missing `.agent` skill modules restored or those legacy tests isolated before it can serve as a complete release gate.
