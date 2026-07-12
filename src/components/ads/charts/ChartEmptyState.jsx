export default function ChartEmptyState({ message = 'このグラフグループには描画できるデータ系列がありません。' }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low px-5 py-8 text-center">
      <span className="material-symbols-outlined text-4xl text-outline" aria-hidden="true">insert_chart_off</span>
      <p className="mt-3 text-sm font-bold text-on-surface japanese-text">{message}</p>
      <p className="mt-1 text-xs font-medium text-on-surface-variant japanese-text">
        取得できなかった値は 0 とみなさず、データ不足として扱っています。
      </p>
    </div>
  )
}
