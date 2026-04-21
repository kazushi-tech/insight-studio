import { useState, useEffect, useRef } from 'react'
import { getCases } from '../api/adsInsights'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useAuth } from '../contexts/AuthContext'
import { useRbac } from '../contexts/RbacContext'

export default function CaseSelector({ onCaseSelect }) {
  const { currentCase, isSetupComplete } = useAdsSetup()
  const { isClient, canAccessProject } = useRbac()
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [cases, setCases] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [confirmCase, setConfirmCase] = useState(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen && cases.length === 0) {
      setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- data-fetching init
      setError(null)
      getCases()
        .then((data) => {
          setCases(Array.isArray(data) ? data : data.cases || [])
        })
        .catch((e) => {
          setError(e.message || '案件一覧の取得に失敗しました')
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen, cases.length])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
        setConfirmCase(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const accessibleCases = cases
    .filter((c) => !c.is_internal || user?.role === 'admin')
    .filter((c) => (isClient ? canAccessProject(c.case_id || c.id) : true))

  const filteredCases = accessibleCases.filter((c) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelect = (caseInfo) => {
    // If setup is complete and switching to a different case, show confirmation
    if (isSetupComplete && currentCase?.case_id && currentCase.case_id !== (caseInfo.id || caseInfo.case_id)) {
      setConfirmCase(caseInfo)
      return
    }
    doSelect(caseInfo)
  }

  const doSelect = (caseInfo) => {
    setIsOpen(false)
    setSearchQuery('')
    setConfirmCase(null)
    onCaseSelect?.(caseInfo)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setConfirmCase(null)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-surface-container-low rounded-xl text-sm font-medium hover:bg-surface-container transition-colors focus-visible:outline-2 focus-visible:outline-secondary"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="material-symbols-outlined text-lg text-on-surface-variant">
          {currentCase ? 'folder_open' : 'folder'}
        </span>
        <span className="japanese-text truncate max-w-[200px]">
          {currentCase ? currentCase.name : '案件を選択'}
        </span>
        {currentCase?.dataset_id && (
          <span className="w-2 h-2 rounded-full bg-emerald-500" title="BQデータセット設定済" />
        )}
        <span
          className={`material-symbols-outlined text-base transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-2 w-80 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/20 z-50 overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Confirm dialog */}
          {confirmCase && (
            <div className="p-4 bg-amber-50 dark:bg-warning-container border-b border-amber-200 dark:border-warning/30">
              <p className="text-sm text-amber-800 dark:text-on-warning-container japanese-text mb-3">
                案件を切り替えると、現在のセットアップがリセットされます。よろしいですか？
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => doSelect(confirmCase)}
                  className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:opacity-90"
                >
                  切り替える
                </button>
                <button
                  onClick={() => setConfirmCase(null)}
                  className="px-4 py-1.5 text-amber-700 dark:text-on-warning-container text-xs font-bold hover:underline"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* Search input */}
          <div className="p-3 border-b border-outline-variant/20">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                search
              </span>
              <input
                ref={inputRef}
                type="text"
                placeholder="案件を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-container rounded-lg py-2 pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              />
            </div>
          </div>

          {/* Case list */}
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-on-surface-variant">
                <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                <span className="text-sm japanese-text">読み込み中...</span>
              </div>
            )}

            {error && (
              <div className="px-4 py-3 text-sm text-error japanese-text">{error}</div>
            )}

            {!loading && !error && filteredCases.length === 0 && (
              <div className="px-4 py-3 text-sm text-on-surface-variant japanese-text">
                {searchQuery ? '一致する案件がありません' : '案件がありません'}
              </div>
            )}

            {!loading &&
              !error &&
              filteredCases.map((c) => {
                const caseId = c.id || c.case_id
                const isSelected = currentCase?.case_id === caseId
                return (
                  <button
                    key={caseId}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(c)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-container transition-colors ${
                      isSelected
                        ? 'bg-primary-container/20 text-primary'
                        : 'text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg text-on-surface-variant">
                      {isSelected ? 'check' : 'description'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="japanese-text truncate block">{c.name}</span>
                      {c.dataset_id && (
                        <span className="text-[10px] text-on-surface-variant font-mono truncate block">{c.dataset_id}</span>
                      )}
                    </div>
                    {c.dataset_id && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="BQ接続あり" />
                    )}
                  </button>
                )
              })}
          </div>

          {/* Clear selection */}
          {currentCase && (
            <div className="border-t border-outline-variant/20">
              <button
                onClick={() => {
                  setIsOpen(false)
                  setConfirmCase(null)
                  onCaseSelect?.(null)
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
              >
                <span className="material-symbols-outlined text-base">close</span>
                <span className="japanese-text">案件選択を解除</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
