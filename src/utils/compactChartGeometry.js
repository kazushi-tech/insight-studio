function finiteValues(dataset) {
  return (Array.isArray(dataset?.data) ? dataset.data : [])
    .map((value) => {
      if (value == null || (typeof value === 'string' && !value.trim())) return null
      return Number(typeof value === 'string'
        ? value.replace(/,/g, '').replace(/[%％]$/, '')
        : value)
    })
    .map((value) => (Number.isFinite(value) ? value : null))
}

function coordinate(value, min, span, extent) {
  return ((value - min) / span) * extent
}

export function buildCompactChartGeometry(chartType, datasets, width = 240, height = 60) {
  const series = (Array.isArray(datasets) ? datasets : [])
    .slice(0, 2)
    .map(finiteValues)
    .filter((values) => values.some((value) => value != null))
  if (series.length === 0) return { kind: 'empty', series: [] }

  if (chartType === 'bar_horizontal') {
    const values = series[0].slice(0, 6)
    const finite = values.filter((value) => value != null)
    const min = Math.min(0, ...finite)
    const max = Math.max(0, ...finite)
    const span = max - min || 1
    const zero = coordinate(0, min, span, width)
    const rowHeight = height / Math.max(values.length, 1)
    return {
      kind: 'bar',
      series: values.flatMap((value, index) => {
        if (value == null) return []
        const edge = coordinate(value, min, span, width)
        return [{
          x: Math.min(zero, edge),
          y: index * rowHeight + 2,
          width: Math.max(Math.abs(edge - zero), 1),
          height: Math.max(rowHeight - 4, 2),
        }]
      }),
    }
  }

  const finite = series.flat().filter((value) => value != null)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = max - min || 1
  return {
    kind: 'line',
    series: series.map((values) => {
      const denominator = Math.max(values.length - 1, 1)
      return values.flatMap((value, index) => value == null ? [] : [{
        x: values.length === 1 ? width / 2 : (index / denominator) * width,
        y: max === min ? height / 2 : height - coordinate(value, min, span, height),
      }])
    }),
  }
}
