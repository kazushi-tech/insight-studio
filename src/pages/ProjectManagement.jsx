import { useState, useEffect, useCallback } from 'react'
import { useRbac } from '../contexts/RbacContext'
import { useAuth } from '../contexts/AuthContext'
import { getCases, getCaseBqStatus } from '../api/adsInsights'
import ProjectTable from '../components/ProjectTable'
import ProjectFormModal from '../components/ProjectFormModal'
import InviteModal from '../components/InviteModal'

export default function ProjectManagement() {
  const { canManageProjects } = useRbac()
  const { isAdsAuthenticated } = useAuth()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [sharingProject, setSharingProject] = useState(null)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [bqStatuses, setBqStatuses] = useState({})

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getCases()
      const list = Array.isArray(data) ? data : data.cases || []
      setProjects(list)

      // Auto-test BQ for cases with dataset_id
      const withDataset = list.filter((c) => c.dataset_id)
      for (const c of withDataset) {
        setBqStatuses((prev) => ({ ...prev, [c.case_id]: { loading: true } }))
        getCaseBqStatus(c.case_id)
          .then((result) => setBqStatuses((prev) => ({ ...prev, [c.case_id]: result })))
          .catch((e) => setBqStatuses((prev) => ({ ...prev, [c.case_id]: { error: e.message } })))
      }
    } catch {
      // Silently handle — table will show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdsAuthenticated) {
      fetchProjects()
    } else {
      setLoading(false)
    }
  }, [fetchProjects, isAdsAuthenticated])

  const handleBqTest = useCallback(async (caseId) => {
    setBqStatuses((prev) => ({ ...prev, [caseId]: { loading: true } }))
    try {
      const result = await getCaseBqStatus(caseId)
      setBqStatuses((prev) => ({ ...prev, [caseId]: result }))
    } catch (e) {
      setBqStatuses((prev) => ({ ...prev, [caseId]: { error: e.message } }))
    }
  }, [])

  const handleModalClose = useCallback(() => {
    setShowCreateModal(false)
    setEditingProject(null)
    fetchProjects()
  }, [fetchProjects])

  return (
    <div className="p-8 max-w-7xl mx-auto w-full space-y-8 relative">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="text-primary font-bold text-xs tracking-[0.2em] uppercase japanese-text">プロジェクト概要</p>
          <h2 className="text-5xl font-extrabold font-headline text-on-surface tracking-tighter japanese-text">
            プロジェクト一覧
          </h2>
        </div>
        {canManageProjects && (
          <div className="flex gap-3">
            <button onClick={() => setShowCreateModal(true)} className="button-primary px-6 py-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined text-sm">add</span>
              <span className="japanese-text">新規追加</span>
            </button>
          </div>
        )}
      </section>

      {/* Table */}
      <ProjectTable
        projects={projects}
        loading={loading}
        bqStatuses={bqStatuses}
        onShare={(project) => canManageProjects && setSharingProject(project)}
        onEdit={(project) => canManageProjects && setEditingProject(project)}
        onBqTest={handleBqTest}
      />

      {/* Decorative */}
      <div className="absolute bottom-0 right-0 w-96 h-96 pointer-events-none overflow-hidden -z-10 opacity-20">
        <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] rounded-full bg-primary-fixed blur-[100px]" />
      </div>

      {/* Modals */}
      {(showCreateModal || editingProject) && (
        <ProjectFormModal
          project={editingProject}
          onClose={handleModalClose}
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
