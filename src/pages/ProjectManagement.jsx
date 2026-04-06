import { useState } from 'react'
import { useRbac } from '../contexts/RbacContext'
import ProjectTable from '../components/ProjectTable'
import ProjectFormModal from '../components/ProjectFormModal'
import InviteModal from '../components/InviteModal'

export default function ProjectManagement() {
  const { canManageProjects } = useRbac()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [sharingProject, setSharingProject] = useState(null)

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 relative">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="text-primary font-bold text-xs tracking-[0.2em] uppercase japanese-text">プロジェクト概要</p>
          <h2 className="text-5xl font-extrabold font-headline text-on-surface tracking-tighter japanese-text">
            クライアント<br />プロジェクト一覧
          </h2>
        </div>
        {canManageProjects && (
          <div className="flex gap-3">
            <button className="button-secondary px-6 py-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <span className="material-symbols-outlined text-sm">filter_list</span>
              <span className="japanese-text">フィルター</span>
            </button>
            <button onClick={() => setShowCreateModal(true)} className="button-primary px-6 py-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined text-sm">add</span>
              <span className="japanese-text">新規追加</span>
            </button>
          </div>
        )}
      </section>

      {/* Table */}
      <ProjectTable
        onShare={(project) => canManageProjects && setSharingProject(project)}
        onEdit={(project) => canManageProjects && setEditingProject(project)}
      />

      {/* Decorative */}
      <div className="absolute bottom-0 right-0 w-96 h-96 pointer-events-none overflow-hidden -z-10 opacity-20">
        <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] rounded-full bg-primary-fixed blur-[100px]" />
      </div>

      {/* Modals */}
      {(showCreateModal || editingProject) && (
        <ProjectFormModal
          project={editingProject}
          onClose={() => { setShowCreateModal(false); setEditingProject(null) }}
        />
      )}
      {sharingProject && (
        <InviteModal
          project={sharingProject}
          onClose={() => setSharingProject(null)}
        />
      )}
    </div>
  )
}
