/**
 * チャートグループをテーマ別に分類するユーティリティ
 *
 * chartGroups の title から、CV分析/流入分析/LP分析/デバイス分析/時間帯分析/異常検知
 * に分類する。
 */

const THEME_DEFINITIONS = [
  {
    id: 'cv',
    label: 'CV分析',
    icon: 'conversion_path',
    pattern: /cv|コンバージョン|conversion|cvr|cpa|cpc|roas|費用|cost|獲得|購入|申込|成約/i,
  },
  {
    id: 'traffic',
    label: '流入分析',
    icon: 'swap_horiz',
    pattern: /流入|トラフィック|traffic|session|セッション|source|medium|チャネル|channel|参照元|organic|paid|広告|referral/i,
  },
  {
    id: 'lp',
    label: 'LP分析',
    icon: 'web',
    pattern: /lp|ランディング|landing|ページ|page|pv|ページビュー|pageview|回遊|離脱|直帰|bounce|exit|scroll|滞在/i,
  },
  {
    id: 'device',
    label: 'デバイス分析',
    icon: 'devices',
    pattern: /デバイス|device|mobile|モバイル|pc|desktop|tablet|タブレット|スマホ|smartphone/i,
  },
  {
    id: 'time',
    label: '時間帯分析',
    icon: 'schedule',
    pattern: /時間帯|時間|hour|曜日|day\s*of\s*week|daypart|デイパート|午前|午後|夜間|ピーク/i,
  },
  {
    id: 'anomaly',
    label: '異常検知',
    icon: 'warning',
    pattern: /異常|anomal|急変|急増|急減|逸脱|deviation|outlier|検知|detection|alert/i,
  },
]

/**
 * 単一チャートグループのテーマを判定
 */
export function classifyChartTheme(group) {
  const title = (group?.title ?? '').toLowerCase()

  for (const theme of THEME_DEFINITIONS) {
    if (theme.pattern.test(title)) {
      return theme.id
    }
  }

  return 'other'
}

/**
 * chartGroups をテーマ別にグループ化
 */
export function groupChartsByTheme(chartGroups = []) {
  const themeMap = new Map()

  // 全テーマの空エントリを準備
  for (const theme of THEME_DEFINITIONS) {
    themeMap.set(theme.id, { ...theme, groups: [] })
  }
  themeMap.set('other', { id: 'other', label: 'その他', icon: 'more_horiz', groups: [] })

  for (const group of chartGroups) {
    const themeId = classifyChartTheme(group)
    themeMap.get(themeId).groups.push(group)
  }

  // グループが空のテーマは除外
  return [...themeMap.values()].filter((t) => t.groups.length > 0)
}

/**
 * チャートグループから Top Insight を抽出 (最大3件)
 */
export function extractTopInsights(chartGroups = []) {
  const insights = []

  for (const group of chartGroups) {
    if (insights.length >= 3) break

    const title = group?.title ?? ''
    const datasets = Array.isArray(group?.datasets) ? group.datasets : []
    const labels = Array.isArray(group?.labels) ? group.labels : []

    if (datasets.length === 0 || labels.length === 0) continue

    const data = (datasets[0]?.data ?? []).map((v) => {
      if (v == null || v === '') return null
      const n = typeof v === 'string' ? Number(v.replace(/,/g, '').replace(/[%％]$/, '')) : Number(v)
      return Number.isFinite(n) ? n : null
    }).filter((v) => v !== null)

    if (data.length === 0) continue

    const latest = data[data.length - 1]
    const first = data[0]
    const delta = data.length >= 2 && first !== 0
      ? ((latest - first) / Math.abs(first)) * 100
      : null

    // 異常検知: 大きな下落を検出
    const isAnomaly = delta !== null && delta < -30

    // Evidence タイプ判定
    const evidenceType = /cv|コンバージョン|cvr|セッション|pv|直帰|離脱/i.test(title)
      ? 'observed'
      : /需要|推計|推定|機会/i.test(title)
      ? 'derived'
      : /オークション|競合|benchmark/i.test(title)
      ? 'proxy'
      : 'observed'

    const usePercent = /(cvr|ctr|率|rate|ratio|share|割合|%|％)/i.test(title)
    const formatted = usePercent
      ? `${latest.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
      : latest.toLocaleString('ja-JP', { maximumFractionDigits: 1 })

    insights.push({
      title: title.slice(0, 40),
      value: formatted,
      isPercent: usePercent,
      delta: delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : null,
      deltaPositive: delta !== null ? delta >= 0 : null,
      evidenceType,
      evidenceId: `E-${String(insights.length + 1).padStart(2, '0')}`,
      isAnomaly,
      takeaway: datasets[0]?.label ?? '',
      themeId: classifyChartTheme(group),
    })
  }

  return insights
}

/**
 * テーマ別セクションのサマリー情報を算出
 */
export function computeThemeSummary(themeGroups) {
  const chartCount = themeGroups.length
  let criticalShifts = 0

  for (const group of themeGroups) {
    const datasets = Array.isArray(group?.datasets) ? group.datasets : []
    for (const ds of datasets) {
      const data = (Array.isArray(ds?.data) ? ds.data : [])
        .map((v) => {
          if (v == null) return null
          const n = typeof v === 'string' ? Number(v.replace(/,/g, '').replace(/[%％]$/, '')) : Number(v)
          return Number.isFinite(n) ? n : null
        })
        .filter((v) => v !== null)

      if (data.length < 2) continue
      const last = data[data.length - 1]
      const prev = data[data.length - 2]
      if (prev !== 0 && Math.abs((last - prev) / prev) > 0.3) {
        criticalShifts++
      }
    }
  }

  return { chartCount, criticalShifts }
}

export { THEME_DEFINITIONS }
