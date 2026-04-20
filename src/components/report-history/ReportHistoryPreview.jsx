import MarkdownRenderer from '../MarkdownRenderer'

const PREVIEW_CHAR_LIMIT = 400

export default function ReportHistoryPreview({ entry }) {
  const md = entry?.reportBundle?.reportMd ?? ''
  const snippet = md.length > PREVIEW_CHAR_LIMIT ? `${md.slice(0, PREVIEW_CHAR_LIMIT)}…` : md

  if (!snippet.trim()) {
    return (
      <p className="text-xs text-on-surface-variant japanese-text italic">
        プレビューできるレポート本文がありません
      </p>
    )
  }

  return (
    <div className="bg-surface-container-low rounded-lg px-3 py-2 text-xs max-h-[280px] overflow-y-auto">
      <MarkdownRenderer content={snippet} className="text-xs" size="normal" />
    </div>
  )
}
