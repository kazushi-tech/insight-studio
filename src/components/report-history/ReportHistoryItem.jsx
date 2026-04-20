import { useState } from 'react'
import ReportHistoryPreview from './ReportHistoryPreview'

function formatCreatedAt(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function ReportHistoryItem({ entry, onRestore, onRemove }) {
  const [showPreview, setShowPreview] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const meta = entry?.metadata ?? {}

  return (
    <li className="rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-on-surface tabular-nums">
          {formatCreatedAt(entry.createdAt)}
        </p>
        <button
          type="button"
          onClick={() => onRemove?.(entry.id)}
          className="text-[11px] text-on-surface-variant hover:text-error transition-colors japanese-text"
          aria-label="この履歴を削除"
        >
          削除
        </button>
      </div>

      <p className="text-[11px] text-on-surface-variant japanese-text">
        <span className="font-bold">期間:</span> {meta.periodsLabel ?? '—'}
        <span className="mx-2 opacity-40">|</span>
        <span className="font-bold">クエリ:</span> {meta.queryTypesLabel ?? '—'}
      </p>

      {meta.tldr && (
        <p className="text-sm text-on-surface japanese-text line-clamp-2">
          ≫ {meta.tldr}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-on-surface-variant">
        <span className="flex items-center gap-1 japanese-text">
          <span className="material-symbols-outlined text-[14px]">chat</span>
          {meta.messageCount ?? 0} メッセージ
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant hover:bg-surface-container-high transition-colors japanese-text"
          >
            {showPreview ? 'プレビューを閉じる' : 'プレビュー'}
          </button>
          {confirmRestore ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmRestore(false)
                  onRestore?.(entry.id)
                }}
                className="px-3 py-1 rounded-full bg-primary text-on-primary font-bold hover:opacity-90 transition-all japanese-text"
              >
                復元する
              </button>
              <button
                type="button"
                onClick={() => setConfirmRestore(false)}
                className="px-2 py-1 rounded-full text-on-surface-variant hover:bg-surface-container transition-colors japanese-text"
                aria-label="キャンセル"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRestore(true)}
              className="px-3 py-1 rounded-full bg-secondary text-on-secondary font-bold hover:opacity-90 transition-all japanese-text"
            >
              このレポートを復元
            </button>
          )}
        </div>
      </div>

      {showPreview && <ReportHistoryPreview entry={entry} />}
    </li>
  )
}
