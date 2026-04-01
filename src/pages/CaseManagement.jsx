import { useState, useEffect, useCallback } from 'react'
import { getCases, createCase, updateCase, getCaseBqStatus } from '../api/adsInsights'
import { LoadingSpinner, ErrorBanner } from '../components/ui'

const STATUS_LABELS = { active: '有効', inactive: '無効' }

function BqStatusBadge({ status }) {
  if (!status) return null
  if (status.loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
        確認中
      </span>
    )
  }
  if (status.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        接続OK ({status.tables_found}テーブル)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-500">
      <span className="w-2 h-2 rounded-full bg-red-400" />
      {status.error || '接続失敗'}
    </span>
  )
}

function CaseForm({ onSubmit, onCancel, initialData }) {
  const [formData, setFormData] = useState({
    case_id: initialData?.case_id || '',
    name: initialData?.name || '',
    description: initialData?.description || '',
    dataset_id: initialData?.dataset_id || '',
    password: '',
    status: initialData?.status || 'active',
  })
  const isEdit = Boolean(initialData)

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { ...formData }
    if (!payload.dataset_id) payload.dataset_id = null
    if (!payload.password) payload.password = null
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/20">
      <h3 className="text-lg font-bold japanese-text">{isEdit ? '案件を編集' : '新規案件登録'}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">案件ID</label>
          <input
            type="text"
            value={formData.case_id}
            onChange={(e) => setFormData((p) => ({ ...p, case_id: e.target.value }))}
            disabled={isEdit}
            required
            className="w-full bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-50"
            placeholder="e.g. client_xyz"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">案件名</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
            required
            className="w-full bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            placeholder="クライアント名"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-bold text-on-surface-variant japanese-text">説明</label>
        <input
          type="text"
          value={formData.description}
          onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
          className="w-full bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          placeholder="案件の説明（任意）"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">BigQuery Dataset ID</label>
          <input
            type="text"
            value={formData.dataset_id}
            onChange={(e) => setFormData((p) => ({ ...p, dataset_id: e.target.value }))}
            className="w-full bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            placeholder="analytics_XXXXXXXXX（任意）"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">パスワード</label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
            className="w-full bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            placeholder={isEdit ? '変更する場合のみ入力' : '任意'}
          />
        </div>
      </div>

      {isEdit && (
        <div className="space-y-1">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">ステータス</label>
          <select
            value={formData.status}
            onChange={(e) => setFormData((p) => ({ ...p, status: e.target.value }))}
            className="bg-surface-container-low rounded-xl py-2.5 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            <option value="active">有効</option>
            <option value="inactive">無効</option>
          </select>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="px-6 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all"
        >
          {isEdit ? '更新' : '登録'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2.5 text-on-surface-variant hover:text-primary font-bold text-sm transition-colors"
        >
          キャンセル
        </button>
      </div>
    </form>
  )
}

export default function CaseManagement() {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingCase, setEditingCase] = useState(null)
  const [bqStatuses, setBqStatuses] = useState({})

  const fetchCases = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getCases()
      setCases(Array.isArray(data) ? data : data.cases || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  const handleCreate = async (payload) => {
    setError(null)
    try {
      await createCase(payload)
      setShowForm(false)
      await fetchCases()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleUpdate = async (payload) => {
    setError(null)
    try {
      await updateCase(editingCase.case_id, payload)
      setEditingCase(null)
      await fetchCases()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleBqTest = async (caseItem) => {
    const caseId = caseItem.case_id
    setBqStatuses((prev) => ({ ...prev, [caseId]: { loading: true } }))
    try {
      const result = await getCaseBqStatus(caseId)
      setBqStatuses((prev) => ({ ...prev, [caseId]: result }))
    } catch (e) {
      setBqStatuses((prev) => ({ ...prev, [caseId]: { error: e.message } }))
    }
  }

  return (
    <div className="p-10 max-w-[1200px] mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-on-surface tracking-tight japanese-text">案件管理</h2>
          <p className="text-sm text-on-surface-variant mt-1 japanese-text">クライアント案件の登録・編集・BQ接続テスト</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingCase(null) }}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          <span className="japanese-text">新規案件</span>
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {(showForm || editingCase) && (
        <CaseForm
          initialData={editingCase}
          onSubmit={editingCase ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditingCase(null) }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="lg" label="案件一覧を読み込み中..." />
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-16 text-on-surface-variant japanese-text">
          <span className="material-symbols-outlined text-5xl mb-3 block">folder_off</span>
          <p>登録済みの案件がありません</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-outline-variant/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-left">
                <th className="px-5 py-3 font-bold japanese-text">案件名</th>
                <th className="px-5 py-3 font-bold japanese-text">案件ID</th>
                <th className="px-5 py-3 font-bold japanese-text">Dataset ID</th>
                <th className="px-5 py-3 font-bold japanese-text">ステータス</th>
                <th className="px-5 py-3 font-bold japanese-text">BQ接続</th>
                <th className="px-5 py-3 font-bold japanese-text">操作</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.case_id} className="border-t border-outline-variant/10 hover:bg-surface-container-lowest/50 transition-colors">
                  <td className="px-5 py-3 font-medium japanese-text">{c.name}</td>
                  <td className="px-5 py-3 text-on-surface-variant font-mono text-xs">{c.case_id}</td>
                  <td className="px-5 py-3 text-on-surface-variant font-mono text-xs">{c.dataset_id || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${c.status === 'active' ? 'text-emerald-600' : 'text-on-surface-variant'}`}>
                      <span className={`w-2 h-2 rounded-full ${c.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {c.dataset_id ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleBqTest(c)}
                          disabled={bqStatuses[c.case_id]?.loading}
                          className="text-xs text-secondary hover:text-secondary/80 font-bold transition-colors disabled:opacity-50"
                        >
                          テスト
                        </button>
                        <BqStatusBadge status={bqStatuses[c.case_id]} />
                      </div>
                    ) : (
                      <span className="text-xs text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => { setEditingCase(c); setShowForm(false) }}
                      className="text-xs text-secondary hover:text-secondary/80 font-bold transition-colors"
                    >
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
