import { useState, useEffect, useRef } from 'react'
import { getCases } from '../api/adsInsights'
import { useAdsSetup } from '../contexts/AdsSetupContext'

export default function CaseSelector({ onCaseSelect }) {
  const { currentCase } = useAdsSetup()
  const [isOpen, setIsOpen] = useState(false)
  const [cases, setCases] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen && cases.length === 0) {
      setLoading(true)
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
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredCases = cases.filter((c) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelect = (caseInfo) => {
    setIsOpen(false)
    setSearchQuery('')
    onCaseSelect?.(caseInfo)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
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
              filteredCases.map((c) => (
                <button
                  key={c.id || c.case_id}
                  role="option"
                  aria-selected={currentCase?.case_id === (c.id || c.case_id)}
                  onClick={() => handleSelect(c)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-surface-container transition-colors ${
                    currentCase?.case_id === (c.id || c.case_id)
                      ? 'bg-primary-container/20 text-primary'
                      : 'text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg text-on-surface-variant">
                    {currentCase?.case_id === (c.id || c.case_id) ? 'check' : 'description'}
                  </span>
                  <span className="japanese-text truncate">{c.name}</span>
                </button>
              ))}
          </div>

          {/* Clear selection */}
          {currentCase && (
            <div className="border-t border-outline-variant/20">
              <button
                onClick={() => {
                  setIsOpen(false)
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
