import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFolders, listPeriods, loadData } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

const QUERY_TYPES = [
  { id: 'pv', icon: 'trending_up', label: 'PV分析', desc: 'ページビューの推移とトレンドを可視化します。', color: 'text-orange-500' },
  { id: 'traffic', icon: 'input', label: '流入分析', desc: 'チャネル別の流入元とトラフィック質を特定します。', color: 'text-blue-500' },
  { id: 'cv', icon: 'target', label: 'CV分析', desc: 'コンバージョン経路と成果への寄与を分析します。', color: 'text-emerald-500' },
  { id: 'search_query', icon: 'search', label: '検索クエリ分析', desc: 'キーワードのニーズとパフォーマンスを網羅。', color: 'text-purple-500' },
  { id: 'anomaly', icon: 'warning', label: '異常検知', desc: '数値の急激な変化や乖離を自動で検出します。', color: 'text-red-500' },
  { id: 'lp', icon: 'web', label: 'LP分析', desc: 'ランディングページの離脱率と有効性を判定。', color: 'text-cyan-500' },
  { id: 'device', icon: 'devices', label: 'デバイス分析', desc: 'PC・SP・Tabの利用動向と差異を確認します。', color: 'text-indigo-500' },
  { id: 'hourly', icon: 'schedule', label: '時間帯分析', desc: '成果が出やすい曜日や時間帯の傾向を把握。', color: 'text-amber-500' },
  { id: 'demographics', icon: 'group', label: 'ユーザー属性', desc: '年齢・性別・地域などのデモグラフィック情報。', color: 'text-pink-500' },
  { id: 'engagement', icon: 'timer', label: 'エンゲージメント時間', desc: 'サイト滞在時間やユーザーの熱量を測定。', color: 'text-teal-500' },
  { id: 'auction', icon: 'stacked_bar_chart', label: 'オークション圧分析', desc: '競合他社の入札動向と表示機会損失を分析。', color: 'text-rose-500' },
]

function extractPeriods(data) {
  if (data.periods) return data.periods
  if (data.results) return data.results
  if (data.available_periods) return data.available_periods
  if (data.data) return data.data
  if (Array.isArray(data)) return data
  return []
}

const STEPS = ['クエリタイプ選択', '期間選択', 'レポート生成']

export default function SetupWizard() {
  const navigate = useNavigate()
  const { isAdsAuthenticated } = useAuth()
  const { completeSetup } = useAdsSetup()
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // Step 0: folders from API
  const [folders, setFolders] = useState([])
  const [foldersLoading, setFoldersLoading] = useState(false)

  // Step 1: periods
  const [periods, setPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)

  // Step 2: load result
  const [loadResult, setLoadResult] = useState(null)

  useEffect(() => {
    if (!isAdsAuthenticated) return
    setFoldersLoading(true)
    getFolders()
      .then((data) => {
        const items = data.folders ?? data.results ?? (Array.isArray(data) ? data : [])
        setFolders(items)
      })
      .catch((e) => setError(e.message))
      .finally(() => setFoldersLoading(false))
  }, [isAdsAuthenticated])

  const toggle = (i) => {
    const next = new Set(selected)
    next.has(i) ? next.delete(i) : next.add(i)
    setSelected(next)
  }

  async function handleNext() {
    setError(null)
    if (step === 0) {
      if (selected.size === 0) return
      setLoading(true)
      try {
        const queryTypeIds = [...selected].map((i) => QUERY_TYPES[i].id)
        const data = await listPeriods({ query_types: queryTypeIds.join(',') })
        const items = extractPeriods(data)
        setPeriods(items)
        setStep(1)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    } else if (step === 1) {
      if (!selectedPeriod) return
      setLoading(true)
      try {
        const queryTypeIds = [...selected].map((i) => QUERY_TYPES[i].id)
        const data = await loadData({ query_types: queryTypeIds, period: selectedPeriod })
        setLoadResult(data)
        completeSetup({ queryTypes: queryTypeIds, period: selectedPeriod })
        setStep(2)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    } else if (step === 2) {
      navigate('/ads/pack')
    }
  }

  function handleBack() {
    if (step > 0) setStep(step - 1)
  }

  return (
    <div className="p-10 max-w-[1200px] mx-auto space-y-10">
      {/* Header with tabs */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight">Setup Wizard</h2>
        <div className="flex bg-surface-container rounded-full p-1">
          {['EXCEL', 'BIGQUERY', '統合'].map((tab, i) => (
            <button
              key={tab}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
                i === 1 ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {!isAdsAuthenticated && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">考察スタジオへのログインが必要です。ヘッダーの鍵アイコンから認証してください。</span>
        </div>
      )}

      {/* Steps indicator */}
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                i === step
                  ? 'bg-secondary text-on-secondary border-secondary'
                  : i < step
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'
              }`}
            >
              {i < step ? <span className="material-symbols-outlined text-sm">check</span> : i + 1}
            </div>
            <span className={`text-sm font-bold ${i === step ? 'text-[#1A1A2E]' : 'text-on-surface-variant'}`}>
              {s}
            </span>
            {i < STEPS.length - 1 && <div className="w-32 h-0.5 bg-outline-variant/30 mx-4" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Step 0: Query Type Selection */}
      {step === 0 && (
        <div>
          <div className="flex justify-between items-end mb-6">
            <div>
              <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text">クエリタイプを選択</h3>
              <p className="text-on-surface-variant mt-1 text-sm">分析したいデータ項目を選択してください（複数選択可能）</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelected(new Set())} className="px-4 py-2 border border-outline-variant/50 rounded-xl text-sm font-bold hover:bg-surface-container transition-all">
                全解除
              </button>
              <button onClick={() => setSelected(new Set(QUERY_TYPES.map((_, i) => i)))} className="px-4 py-2 border border-outline-variant/50 rounded-xl text-sm font-bold hover:bg-surface-container transition-all">
                全選択
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {QUERY_TYPES.map((qt, i) => (
              <button
                key={qt.label}
                onClick={() => toggle(i)}
                className={`p-5 rounded-2xl text-left transition-all border-2 ${
                  selected.has(i)
                    ? 'border-secondary bg-secondary/5 shadow-lg shadow-secondary/10'
                    : 'border-transparent bg-surface-container-lowest shadow-[0_24px_48px_-12px_rgba(26,26,46,0.04)] hover:shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`material-symbols-outlined text-2xl ${qt.color}`}>{qt.icon}</span>
                    <span className="font-bold text-[#1A1A2E] japanese-text">{qt.label}</span>
                  </div>
                  {selected.has(i) && (
                    <span className="material-symbols-outlined text-secondary">check_circle</span>
                  )}
                </div>
                <p className="text-xs text-on-surface-variant mt-2 leading-relaxed japanese-text">{qt.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Period Selection */}
      {step === 1 && (
        <div>
          <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text mb-4">分析期間を選択</h3>
          {periods.length === 0 ? (
            <p className="text-on-surface-variant text-sm japanese-text">利用可能な期間がありません。</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {periods.map((p, i) => {
                const label = typeof p === 'string' ? p : p.label ?? p.period ?? `期間 ${i + 1}`
                const value = typeof p === 'string' ? p : p.value ?? p.period ?? p
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedPeriod(value)}
                    className={`p-5 rounded-2xl text-left transition-all border-2 ${
                      selectedPeriod === value
                        ? 'border-secondary bg-secondary/5 shadow-lg shadow-secondary/10'
                        : 'border-transparent bg-surface-container-lowest shadow-[0_24px_48px_-12px_rgba(26,26,46,0.04)] hover:shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-secondary">calendar_today</span>
                      <span className="font-bold text-[#1A1A2E] japanese-text">{label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Load Complete */}
      {step === 2 && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">check_circle</span>
          <h3 className="text-2xl font-bold text-[#1A1A2E] japanese-text">データ読み込み完了</h3>
          <p className="text-on-surface-variant mt-2 japanese-text">「次へ」を押して要点パックに進みましょう。</p>
          {loadResult?.summary && (
            <p className="text-sm text-on-surface-variant mt-4 japanese-text">{loadResult.summary}</p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-center gap-4 pt-4">
        <button
          onClick={handleBack}
          disabled={step === 0}
          className="px-10 py-3 border border-outline-variant/50 rounded-xl font-bold text-sm hover:bg-surface-container transition-all disabled:opacity-50"
        >
          戻る
        </button>
        <button
          onClick={handleNext}
          disabled={loading || (step === 0 && selected.size === 0) || (step === 1 && !selectedPeriod) || !isAdsAuthenticated}
          className="px-10 py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-secondary/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              処理中…
            </>
          ) : (
            <>
              {step === 2 ? '要点パックへ' : '次へ'}
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
