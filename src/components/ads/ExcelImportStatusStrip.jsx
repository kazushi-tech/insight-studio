export default function ExcelImportStatusStrip({ excelImport, onReupload, onRemove }) {
  if (!excelImport) return null

  return (
    <div className="bg-secondary-container/30 rounded-xl border border-secondary-container px-5 py-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-on-surface japanese-text truncate">
            Excel\u30c7\u30fc\u30bf\u53cd\u6620\u6e08\u307f\uff08{excelImport.fileName}\uff09
          </p>
          <p className="text-[10px] text-on-surface-variant">
            \u6700\u7d42\u66f4\u65b0: {new Date(excelImport.importedAt).toLocaleString('ja-JP')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onReupload} className="text-[11px] font-bold text-on-surface-variant hover:text-on-surface px-3 py-1 rounded-lg hover:bg-surface-container-low transition-colors">
          \u518d\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9
        </button>
        <button onClick={onRemove} className="text-[11px] font-bold text-error/70 hover:text-error px-3 py-1 rounded-lg hover:bg-error/5 transition-colors">
          \u89e3\u9664
        </button>
      </div>
    </div>
  )
}
