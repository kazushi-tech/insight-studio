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
            Excelデータ反映済み（{excelImport.fileName}）
          </p>
          <p className="text-[10px] text-on-surface-variant">
            最終更新: {new Date(excelImport.importedAt).toLocaleString('ja-JP')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onReupload} className="text-[11px] font-bold text-on-surface-variant hover:text-on-surface px-3 py-1 rounded-lg hover:bg-surface-container-low transition-colors">
          再アップロード
        </button>
        <button onClick={onRemove} className="text-[11px] font-bold text-error/70 hover:text-error px-3 py-1 rounded-lg hover:bg-error/5 transition-colors">
          解除
        </button>
      </div>
    </div>
  )
}
