import { useState } from 'react'

const MOCK_PROJECTS = [
  { id: 'PJ-2024-001', name: 'サントリーホールディングス - 基盤構築', client: 'サントリーホールディングス', bqConnected: true, dataVolume: '1.2M行/月', status: 'active', updatedAt: '2024/05/20' },
  { id: 'PJ-2024-042', name: '楽天グループ - 流通分析ダッシュボード', client: '楽天グループ', bqConnected: false, dataVolume: '450K行/月', status: 'active', updatedAt: '2024/05/18' },
  { id: 'PJ-2023-118', name: 'トヨタ自動車 - 需要予測AI', client: 'トヨタ自動車', bqConnected: true, dataVolume: '8.5M行/月', status: 'inactive', updatedAt: '2024/05/12' },
  { id: 'PJ-2024-088', name: '任天堂 - ユーザー行動分析', client: '任天堂', bqConnected: true, dataVolume: '2.1M行/月', status: 'active', updatedAt: '2024/05/15' },
  { id: 'PJ-2024-015', name: '資生堂 - ブランドパフォーマンス追跡', client: '資生堂', bqConnected: true, dataVolume: '680K行/月', status: 'active', updatedAt: '2024/05/21' },
]

function StatusChip({ status }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-primary-container text-on-primary-container uppercase tracking-wider">
        アクティブ
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-surface-variant text-on-surface-variant uppercase tracking-wider">
      停止中
    </span>
  )
}

function BqConnectionChip({ connected }) {
  if (connected) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary-container/30">
          <span className="w-2 h-2 rounded-full bg-secondary" />
          <span className="text-[10px] font-bold text-secondary uppercase">Connected</span>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-error-container/30">
        <span className="w-2 h-2 rounded-full bg-error" />
        <span className="text-[10px] font-bold text-error uppercase">Disconnected</span>
      </div>
    </div>
  )
}

export default function ProjectTable({ onShare, onEdit }) {
  const [projects] = useState(MOCK_PROJECTS)
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all'
    ? projects
    : projects.filter((p) => p.status === filter)

  const activeCount = projects.filter((p) => p.status === 'active').length
  const connectedCount = projects.filter((p) => p.bqConnected).length
  const connectedPct = projects.length ? Math.round((connectedCount / projects.length) * 100) : 0

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card space-y-4">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-surface-container-high text-primary">
              <span className="material-symbols-outlined">inventory_2</span>
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant px-2 py-1 bg-surface-container-high rounded-full uppercase tracking-tighter">Total</span>
          </div>
          <div>
            <p className="text-4xl font-extrabold font-headline tracking-tighter">{projects.length}</p>
            <p className="text-xs text-on-surface-variant">全プロジェクト数</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card space-y-4">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-secondary-container text-secondary">
              <span className="material-symbols-outlined">bolt</span>
            </div>
            <span className="text-[10px] font-bold text-secondary px-2 py-1 bg-secondary-container rounded-full uppercase tracking-tighter">Active</span>
          </div>
          <div>
            <p className="text-4xl font-extrabold font-headline tracking-tighter">{activeCount}</p>
            <p className="text-xs text-on-surface-variant">アクティブなプロジェクト</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card space-y-4">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-on-primary-container text-primary-container">
              <span className="material-symbols-outlined">database</span>
            </div>
            <span className="text-[10px] font-bold text-primary-container px-2 py-1 bg-on-primary-container rounded-full uppercase tracking-tighter">Stable</span>
          </div>
          <div>
            <p className="text-4xl font-extrabold font-headline tracking-tighter">{connectedPct}%</p>
            <p className="text-xs text-on-surface-variant">BQ接続済みの割合</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-[0.75rem] panel-card space-y-4">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-tertiary-fixed text-tertiary">
              <span className="material-symbols-outlined">corporate_fare</span>
            </div>
            <span className="text-[10px] font-bold text-tertiary px-2 py-1 bg-tertiary-fixed rounded-full uppercase tracking-tighter">Clients</span>
          </div>
          <div>
            <p className="text-4xl font-extrabold font-headline tracking-tighter">{new Set(projects.map((p) => p.client)).size}</p>
            <p className="text-xs text-on-surface-variant">登録クライアント数</p>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="bg-surface-container-lowest rounded-[0.75rem] panel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant/10">
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">プロジェクト名 & ID</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">クライアント</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-center">BQ 接続</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">データ量</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">ステータス</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">最終更新</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-right">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filtered.map((project) => (
                <tr key={project.id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-6 py-5">
                    <p className="font-bold text-on-surface">{project.name}</p>
                    <p className="text-[10px] text-on-surface-variant font-mono uppercase tracking-tighter">ID: {project.id}</p>
                  </td>
                  <td className="px-6 py-5">
                    <span className="text-sm font-medium">{project.client}</span>
                  </td>
                  <td className="px-6 py-5">
                    <BqConnectionChip connected={project.bqConnected} />
                  </td>
                  <td className="px-6 py-5 text-sm font-medium">{project.dataVolume}</td>
                  <td className="px-6 py-5">
                    <StatusChip status={project.status} />
                  </td>
                  <td className="px-6 py-5 text-sm text-on-surface-variant">{project.updatedAt}</td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="表示">
                        <span className="material-symbols-outlined text-lg">visibility</span>
                      </button>
                      <button className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="編集" onClick={() => onEdit?.(project)}>
                        <span className="material-symbols-outlined text-lg">edit</span>
                      </button>
                      <button className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="共有" onClick={() => onShare?.(project)}>
                        <span className="material-symbols-outlined text-lg">share</span>
                      </button>
                      <button className="p-2 text-on-surface-variant hover:text-error transition-colors" title="削除">
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-surface-container border-t border-outline-variant/10 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant font-medium">
            全 {projects.length} プロジェクト中 1-{filtered.length}件を表示
          </p>
          <div className="flex gap-2">
            <button className="button-secondary px-3 py-1 text-xs font-bold" disabled>Previous</button>
            <button className="px-3 py-1 bg-primary text-on-primary rounded-lg text-xs font-bold">Next</button>
          </div>
        </div>
      </section>
    </div>
  )
}
