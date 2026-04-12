import { useRef, useState } from 'react'

export default function ExcelImportBanner({ onFileSelected, disabled }) {
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file && file.name.endsWith('.xlsx')) onFileSelected(file)
  }

  function handleChange(e) {
    const file = e.target.files?.[0]
    if (file) onFileSelected(file)
    e.target.value = ''
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
        dragOver
          ? 'border-primary bg-primary/5'
          : 'border-outline-variant/20 bg-surface-container-low'
      }`}
    >
      <span className="material-symbols-outlined text-xl text-on-surface-variant">upload_file</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface japanese-text">
          月次レポートExcelをアップロードすると、広告詳細グラフとクリエイティブ情報を反映できます
        </p>
        <p className="text-[10px] text-on-surface-variant mt-0.5">対応形式: .xlsx</p>
      </div>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="px-5 py-2 bg-primary-container text-on-primary rounded-xl text-sm font-bold whitespace-nowrap hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        Excelをアップロード
      </button>
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleChange} />
    </div>
  )
}
