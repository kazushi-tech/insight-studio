function periodValue(period) {
  return typeof period === 'string' ? period : period?.period_tag ?? period?.value ?? period?.period ?? period
}

export function latestPeriodValue(periods) {
  return periods.length > 0 ? periodValue(periods[0]) : null
}
