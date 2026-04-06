import { useRbac } from '../contexts/RbacContext'

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

function BqConnectionChip({ caseId, bqStatus, datasetId, onBqTest }) {
  const { canManageProjects } = useRbac()

  if (!datasetId) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-variant/30">
          <span className="w-2 h-2 rounded-full bg-outline" />
          <span className="text-[10px] font-bold text-on-surface-variant uppercase">未設定</span>
        </div>
      </div>
    )
  }

  if (bqStatus?.loading) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-variant/30">
          <span className="material-symbols-outlined text-xs animate-spin text-on-surface-variant">progress_activity</span>
          <span className="text-[10px] font-bold text-on-surface-variant uppercase">確認中</span>
        </div>
      </div>
    )
  }

  if (bqStatus?.connected) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary-container/30">
          <span className="w-2 h-2 rounded-full bg-secondary" />
          <span className="text-[10px] font-bold text-secondary uppercase">
            {canManageProjects ? `Connected (${bqStatus.tables_found}テーブル)` : '接続済み'}
          </span>
        </div>
      </div>
    )
  }

  if (bqStatus && !bqStatus.loading) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-error-container/30">
          <span className="w-2 h-2 rounded-full bg-error" />
          <span className="text-[10px] font-bold text-error uppercase">
            {canManageProjects ? (bqStatus.error || 'エラー') : '設定中'}
          </span>
          {canManageProjects && onBqTest && (
            <button onClick={() => onBqTest(caseId)} className="ml-1 text-[10px] underline text-error hover:text-error/80">再テスト</button>
          )}
        </div>
      </div>
    )
  }

  // Not yet tested — show as pending for clients
  if (!canManageProjects) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-100/30">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-[10px] font-bold text-amber-600 uppercase">設定中</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-variant/30">
        <span className="w-2 h-2 rounded-full bg-outline" />
        <span className="text-[10px] font-bold text-on-surface-variant uppercase">未テスト</span>
      </div>
    </div>
  )
}

export default function ProjectTable({ projects, loading, bqStatuses, onShare, onEdit, onBqTest }) {
  const { canManageProjects } = useRbac()

  const activeCount = projects.filter((p) => p.status === 'active').length
  const connectedCount = Object.values(bqStatuses || {}).filter((s) => s?.connected).length
  const connectedPct = projects.length ? Math.round((connectedCount / projects.length) * 100) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="material-symbols-outlined text-4xl animate-spin text-primary">progress_activity</span>
        <span className="ml-3 text-on-surface-variant japanese-text">プロジェクトを読み込み中...</span>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-20 text-on-surface-variant japanese-text">
        <span className="material-symbols-outlined text-5xl mb-3 block">folder_off</span>
        <p>登録済みのプロジェクトがありません</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </section>

      {/* Table */}
      <section className="bg-surface-container-lowest rounded-[0.75rem] panel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant/10">
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">プロジェクト名 & ID</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-center">BQ 接続</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider">ステータス</th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-right">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {projects.map((project) => (
                <tr key={project.case_id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-6 py-5">
                    <p className="font-bold text-on-surface">{project.name}</p>
                    <p className="text-[10px] text-on-surface-variant font-mono uppercase tracking-tighter">ID: {project.case_id}</p>
                    {project.description && (
                      <p className="text-xs text-on-surface-variant mt-0.5">{project.description}</p>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <BqConnectionChip
                      caseId={project.case_id}
                      bqStatus={bqStatuses?.[project.case_id]}
                      datasetId={project.dataset_id}
                      onBqTest={onBqTest}
                    />
                  </td>
                  <td className="px-6 py-5">
                    <StatusChip status={project.status} />
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end gap-2">
                      {canManageProjects && (
                        <>
                          <button className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="編集" onClick={() => onEdit?.(project)}>
                            <span className="material-symbols-outlined text-lg">edit</span>
                          </button>
                          <button className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="共有" onClick={() => onShare?.(project)}>
                            <span className="material-symbols-outlined text-lg">share</span>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-surface-container border-t border-outline-variant/10 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant font-medium">
            全 {projects.length} プロジェクト
          </p>
        </div>
      </section>
    </div>
  )
}
