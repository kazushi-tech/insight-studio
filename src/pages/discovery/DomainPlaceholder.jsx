function domainColor(domain) {
  let hash = 0
  for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash)
  const h = Math.abs(hash) % 360
  // F-06: Botanical Green (#003925) トーンに統一するため彩度を下げて緑寄りに誘導
  return `hsl(${h}, 28%, 38%)`
}

export default function DomainPlaceholder({ domain }) {
  const initial = (domain || '?').replace(/^www\./, '').charAt(0).toUpperCase()
  const color = domainColor(domain || '')
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
         style={{ background: `linear-gradient(135deg, ${color}18, ${color}30, ${color}18)` }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black text-white shadow-lg"
           style={{ backgroundColor: color }}>
        {initial}
      </div>
      <span className="text-xs font-bold text-on-surface-variant/60 tracking-wide truncate max-w-[200px]">
        {(domain || '').replace(/^www\./, '')}
      </span>
      <span className="material-symbols-outlined text-on-surface-variant/15 absolute bottom-3 right-3 text-4xl">language</span>
    </div>
  )
}
