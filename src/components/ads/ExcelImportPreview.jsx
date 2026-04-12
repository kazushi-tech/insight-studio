import { getExtractionSummary } from '../../utils/excelImporter'

const STATUS_STYLE = {
  extracted: { icon: 'check_circle', color: 'text-primary', label: '\u62bd\u51fa\u6210\u529f' },
  not_found: { icon: 'remove_circle_outline', color: 'text-on-surface-variant/50', label: '\u672a\u691c\u51fa' },
  warning: { icon: 'warning', color: 'text-accent-gold', label: '\u8b66\u544a' },
}

export default function ExcelImportPreview({ result, onApply, onCancel }) {
  if (!result) return null

  const items = getExtractionSummary(result)
  const extractedCount = items.filter((i) => i.status === 'extracted').length

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-xl">preview</span>
          <div>
            <h3 className="text-sm font-bold text-on-surface japanese-text">\u89e3\u6790\u30d7\u30ec\u30d3\u30e5\u30fc</h3>
            <p className="text-[10px] text-on-surface-variant">{result.fileName}</p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-primary bg-primary/5 border border-primary/10 px-2 py-0.5 rounded-full">
          {extractedCount}/{items.length} \u30bb\u30af\u30b7\u30e7\u30f3\u691c\u51fa
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((item) => {
          const s = STATUS_STYLE[item.status] || STATUS_STYLE.not_found
          return (
            <div key={item.label} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low">
              <span className={`material-symbols-outlined text-base ${s.color}`}>{s.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-on-surface japanese-text">{item.label}</p>
                <p className={`text-[10px] ${s.color}`}>
                  {s.label}{item.count != null && item.status === 'extracted' ? ` (${item.count}\u4ef6)` : ''}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {result.warnings?.length > 0 && (
        <div className="bg-accent-gold/5 border border-accent-gold/15 rounded-lg p-3 space-y-1">
          {result.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent-gold text-sm">info</span>
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onApply}
          disabled={extractedCount === 0}
          className="px-6 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-base">check</span>
          \u30b0\u30e9\u30d5\u306b\u53cd\u6620\u3059\u308b
        </button>
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-sm font-bold text-on-surface-variant hover:text-on-surface transition-colors"
        >
          \u30ad\u30e3\u30f3\u30bb\u30eb
        </button>
      </div>
    </div>
  )
}
