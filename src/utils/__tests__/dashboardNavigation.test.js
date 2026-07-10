import { describe, expect, it } from 'vitest'
import { resolveBeginnerReportAction } from '../dashboardNavigation'

describe('resolveBeginnerReportAction', () => {
  it.each([
    [false, false, false, '/ads/wizard', 'データ接続を確認する'],
    [true, false, false, '/ads/wizard', 'サイト分析を準備する'],
    [true, true, false, '/ads/report', '前回の条件でレポートを表示'],
    [true, true, true, '/ads/report', '最新レポートを見る'],
  ])(
    'routes authentication=%s dataset=%s report=%s to the expected action',
    (isAdsAuthenticated, hasDataset, hasReport, path, label) => {
      expect(resolveBeginnerReportAction({ isAdsAuthenticated, hasDataset, hasReport })).toEqual({ path, label })
    },
  )
})
