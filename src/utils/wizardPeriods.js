function periodValue(period) {
  return typeof period === 'string' ? period : period?.period_tag ?? period?.value ?? period?.period ?? period
}

export function latestPeriodValue(periods) {
  const values = (Array.isArray(periods) ? periods : [])
    .map(periodValue)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)

  return values.reduce((latest, value) => (
    latest == null || value.localeCompare(latest, 'en') > 0 ? value : latest
  ), null)
}

export function periodRangeLabel(periods) {
  const values = (Array.isArray(periods) ? periods : [])
    .map(periodValue)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right, 'en'))

  if (values.length === 0) return null
  if (values.length === 1) return values[0]
  return `${values[0]} 〜 ${values[values.length - 1]}`
}
