export function resolveBeginnerReportAction({ isAdsAuthenticated, hasDataset, hasReport }) {
  if (!isAdsAuthenticated) return { path: '/ads/wizard', label: 'データ接続を確認する' }
  if (!hasDataset) return { path: '/ads/wizard', label: 'サイト分析を準備する' }
  if (!hasReport) return { path: '/ads/report', label: '前回の条件でレポートを表示' }
  return { path: '/ads/report', label: '最新レポートを見る' }
}
