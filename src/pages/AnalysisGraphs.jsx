import { useEffect, useMemo, useState } from 'react'
import { loadData } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatLabel(key) {
  return key.replace(/_/g, ' ')
}

function describeValue(value) {
  if (Array.isArray(value)) return `${value.length} 件`
  if (isPlainObject(value)) return `${Object.keys(value).length} キー`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return 'null'
  return String(value)
}

function getTopLevelEntries(data) {
  if (Array.isArray(data)) {
    return [['results', data]]
  }

  if (isPlainObject(data)) {
    return Object.entries(data)
  }

  if (data == null) return []

  return [['value', data]]
}

function getPreviewColumns(rows) {
  const columns = []

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!columns.includes(key)) columns.push(key)
    })
  })

  return columns.slice(0, 6)
}

function renderPreviewValue(value) {
  if (value == null) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState } = useAdsSetup()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isAdsAuthenticated || !setupState) return

    let cancelled = false

    ;(async () => {
      if (!cancelled) {
        setLoading(true)
        setError(null)
        setData(null)
      }

      try {
        const result = await loadData({
          type: 'graphs',
          query_types: setupState.queryTypes,
          periods: setupState.periods,
          granularity: setupState.granularity,
        })

        if (!cancelled) setData(result)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAdsAuthenticated, setupState])

  const topLevelEntries = useMemo(() => getTopLevelEntries(data), [data])
  const scalarEntries = topLevelEntries.filter(([, value]) => !Array.isArray(value) && !isPlainObject(value))
  const collectionEntries = topLevelEntries.filter(([, value]) => Array.isArray(value) || isPlainObject(value))
  const summaryText = topLevelEntries
    .filter(([, value]) => typeof value === 'string')
    .map(([, value]) => value)
    .find((value) => value.trim().length > 40) ?? null

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">広告パフォーマンス分析グラフ</h2>
        {setupState && (
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <span className="px-3 py-1 bg-surface-container rounded-lg font-bold">
              {setupState.granularity === 'monthly' ? '月別' : setupState.granularity === 'weekly' ? '週別' : '日別'}
            </span>
            <span>{setupState.periods?.length ?? 0}期間</span>
            <span>{setupState.queryTypes?.length ?? 0}クエリ</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {setupState?.periods?.map((period) => (
          <span key={period} className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
            期間: {period}
          </span>
        ))}
        {setupState?.queryTypes?.map((queryType) => (
          <span key={queryType} className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
            クエリ: {queryType}
          </span>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant bg-surface-container-lowest rounded-2xl">
          <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
          <span className="text-sm japanese-text">BigQuery 由来のグラフデータを取得中…</span>
        </div>
      )}

      {!loading && !error && !data && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 text-center space-y-3">
          <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
          <h3 className="text-xl font-bold japanese-text">グラフデータを取得中です</h3>
          <p className="text-sm text-on-surface-variant japanese-text">
            ダミーのチャートは表示せず、backend が返した内容だけをこの画面に出します。
          </p>
        </div>
      )}

      {data && (
        <>
          {summaryText && (
            <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-secondary">insights</span>
                <div>
                  <h3 className="text-xl font-bold japanese-text">要約</h3>
                  <p className="text-sm text-on-surface-variant">backend が返した本文の先頭を表示しています</p>
                </div>
              </div>
              <div className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap japanese-text">{summaryText}</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {scalarEntries.length > 0 ? (
              scalarEntries.slice(0, 6).map(([key, value]) => (
                <div key={key} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-5">
                  <p className="text-xs uppercase tracking-wider text-on-surface-variant font-bold">{formatLabel(key)}</p>
                  <p className="text-2xl font-black mt-2 break-all">{describeValue(value)}</p>
                </div>
              ))
            ) : (
              <div className="col-span-3 bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 text-sm text-amber-800">
                scalar な集計値は返っていません。固定 KPI は表示していません。
              </div>
            )}
          </div>

          <div className="space-y-6">
            {collectionEntries.length > 0 ? (
              collectionEntries.map(([key, value]) => {
                if (Array.isArray(value)) {
                  if (value.length === 0) {
                    return (
                      <div key={key} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
                        <h3 className="text-lg font-bold japanese-text">{formatLabel(key)}</h3>
                        <p className="text-sm text-on-surface-variant mt-2">0 件でした。</p>
                      </div>
                    )
                  }

                  if (value.every(isPlainObject)) {
                    const rows = value.slice(0, 5)
                    const columns = getPreviewColumns(rows)

                    return (
                      <div key={key} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-bold japanese-text">{formatLabel(key)}</h3>
                            <p className="text-xs text-on-surface-variant">先頭 {rows.length} 行 / 全 {value.length} 行を表示</p>
                          </div>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-on-surface-variant border-b border-surface-container">
                              {columns.map((column) => (
                                <th key={column} className="py-3 text-left font-bold">{formatLabel(column)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, rowIndex) => (
                              <tr key={rowIndex} className="border-b border-surface-container/50">
                                {columns.map((column) => (
                                  <td key={column} className="py-3 align-top break-all">{renderPreviewValue(row[column])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  }

                  return (
                    <div key={key} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
                      <div>
                        <h3 className="text-lg font-bold japanese-text">{formatLabel(key)}</h3>
                        <p className="text-xs text-on-surface-variant">先頭 {Math.min(value.length, 10)} 件 / 全 {value.length} 件を表示</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {value.slice(0, 10).map((item, index) => (
                          <span key={index} className="px-3 py-1.5 bg-surface-container rounded-lg text-sm break-all">
                            {renderPreviewValue(item)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                }

                const entries = Object.entries(value)

                return (
                  <div key={key} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
                    <div>
                      <h3 className="text-lg font-bold japanese-text">{formatLabel(key)}</h3>
                      <p className="text-xs text-on-surface-variant">上位 {Math.min(entries.length, 10)} キーを表示</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {entries.slice(0, 10).map(([entryKey, entryValue]) => (
                        <div key={entryKey} className="bg-surface-container rounded-xl px-4 py-3">
                          <p className="text-xs uppercase tracking-wider text-on-surface-variant font-bold">{formatLabel(entryKey)}</p>
                          <p className="text-sm mt-2 break-all">{renderPreviewValue(entryValue)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 text-sm text-amber-800">
                グラフ化できる collection データは backend から返っていません。固定チャートは表示していません。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
