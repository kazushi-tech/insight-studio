import { useCallback, useEffect, useState } from 'react'

import { platformApi } from '../api/platform'
import DataStatePanel from '../components/DataStatePanel'
import ProjectEditorDialog from '../components/project/ProjectEditorDialog'
import ProjectMembersDialog from '../components/project/ProjectMembersDialog'
import { useRbac } from '../contexts/RbacContext'

const STATUS_LABELS = {
  active: '利用中',
  inactive: '停止中',
  archived: 'アーカイブ済み',
}

function ConnectionBadge({ connection }) {
  if (!connection || connection.status === 'checking') return <span role="status" className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant">確認中</span>
  if (connection?.status === 'active') return <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-bold text-on-primary-fixed">接続済み</span>
  if (connection?.unavailable) return <span className="rounded-full bg-error-container px-3 py-1 text-xs font-bold text-on-error-container">取得できません</span>
  if (connection?.configured) return <span className="rounded-full bg-tertiary-container px-3 py-1 text-xs font-bold text-on-tertiary-container">確認が必要</span>
  return <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant">未接続</span>
}

export default function ProjectManagement() {
  const { canManageProjects } = useRbac()
  const [projects, setProjects] = useState([])
  const [connections, setConnections] = useState({})
  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null)
  const [membersFor, setMembersFor] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setState('loading')
    setMessage('')
    try {
      const response = await platformApi.listProjects()
      const list = (Array.isArray(response.projects) ? response.projects : [])
        .filter((project) => project.status !== 'deleted')
      setProjects(list)
      setState(list.length ? 'ready' : 'empty')
      setConnections(Object.fromEntries(list.map((project) => [project.id, { status: 'checking' }])))
      const settled = await Promise.all(list.map(async (project) => {
        try {
          const source = await platformApi.getDataSource(project.id)
          return [project.id, source.data_source || { configured: false }]
        } catch (error) {
          if (error?.status === 404) return [project.id, { configured: false }]
          return [project.id, { configured: false, unavailable: true }]
        }
      }))
      setConnections(Object.fromEntries(settled))
    } catch {
      setState('error')
      setMessage('案件一覧を確認できませんでした。少し待ってもう一度お試しください。')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function archive(project) {
    if (!window.confirm(`「${project.name}」をアーカイブしますか？レポート履歴は削除されません。`)) return
    setBusyId(project.id)
    setMessage('')
    try {
      await platformApi.archiveProject(project.id, project.version)
      await load()
      setMessage('案件をアーカイブしました。')
    } catch {
      setMessage('案件をアーカイブできませんでした。別の画面で更新された可能性があります。')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-primary">PROJECTS</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl japanese-text">分析するサイト</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-on-surface-variant japanese-text">サイトごとにデータ接続、レポート、閲覧できるメンバーを安全に分けて管理します。</p>
        </div>
        {canManageProjects && <button type="button" onClick={() => setEditing({ mode: 'create' })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-on-primary"><span className="material-symbols-outlined" aria-hidden="true">add</span>サイトを登録</button>}
      </header>

      {message && state !== 'error' && <p role="status" className="rounded-xl bg-secondary-container px-4 py-3 text-sm font-bold text-on-secondary-container japanese-text">{message}</p>}

      {state === 'loading' && <DataStatePanel state="loading" message="案件を確認しています。" />}
      {state === 'error' && <DataStatePanel state="error" message={message} onRetry={load} />}
      {state === 'empty' && <DataStatePanel state="empty" title="分析するサイトがまだありません" message="最初のサイトを登録すると、データ接続とメンバー設定へ進めます。">{canManageProjects && <button type="button" onClick={() => setEditing({ mode: 'create' })} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-black text-on-primary">最初のサイトを登録</button>}</DataStatePanel>}

      {state === 'ready' && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id} className="flex min-w-0 flex-col rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-extrabold text-on-surface japanese-text">{project.name}</h2>
                  <p className="mt-1 text-xs font-bold text-on-surface-variant">{STATUS_LABELS[project.status] || '状態を確認中'}</p>
                </div>
                <ConnectionBadge connection={connections[project.id]} />
              </div>
              {project.description && <p className="mt-4 line-clamp-3 text-sm leading-7 text-on-surface-variant japanese-text">{project.description}</p>}
              <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
                <button type="button" onClick={() => setEditing(project)} disabled={busyId === project.id} className="min-h-11 rounded-xl bg-surface-container px-3 text-sm font-bold text-primary hover:bg-surface-container-high disabled:opacity-50">設定</button>
                <button type="button" onClick={() => setMembersFor(project)} disabled={busyId === project.id} className="min-h-11 rounded-xl bg-surface-container px-3 text-sm font-bold text-primary hover:bg-surface-container-high disabled:opacity-50">メンバー</button>
                {project.status !== 'archived' && <button type="button" onClick={() => archive(project)} disabled={busyId === project.id} className="col-span-2 min-h-11 rounded-xl px-3 text-sm font-bold text-error hover:bg-error-container disabled:opacity-50">{busyId === project.id ? '処理しています…' : 'アーカイブ'}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <ProjectEditorDialog project={editing.mode === 'create' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
      {membersFor && <ProjectMembersDialog project={membersFor} onClose={() => setMembersFor(null)} />}
    </div>
  )
}
