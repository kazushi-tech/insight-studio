import { useState, useEffect } from 'react'
import { getConfig, saveConfig } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'

export default function Settings() {
  const { isAdsAuthenticated } = useAuth()
  const [autoArchive, setAutoArchive] = useState(true)
  const [notifications, setNotifications] = useState(true)
  const [dataSync, setDataSync] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isAdsAuthenticated) return
    setConfigLoading(true)
    getConfig()
      .then((data) => {
        if (data.auto_archive != null) setAutoArchive(data.auto_archive)
        if (data.notifications != null) setNotifications(data.notifications)
        if (data.data_sync != null) setDataSync(data.data_sync)
      })
      .catch((e) => setError(e.message))
      .finally(() => setConfigLoading(false))
  }, [isAdsAuthenticated])

  async function handleSave() {
    setError(null)
    setSaving(true)
    setSaved(false)
    try {
      await saveConfig({ auto_archive: autoArchive, notifications, data_sync: dataSync })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const Toggle = ({ checked, onChange }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`w-12 h-7 rounded-full flex items-center px-1 transition-colors ${
        checked ? 'bg-secondary' : 'bg-surface-container-high'
      }`}
    >
      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )

  return (
    <div className="p-10 max-w-[1200px] mx-auto space-y-10">
      <div>
        <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">設定 & レポート管理</h2>
        <p className="text-on-surface-variant mt-2 text-lg">システム環境設定と生成済みレポートの履歴を確認できます。</p>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="col-span-7 space-y-8">
          {/* Profile */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-secondary">person</span>
              <h3 className="text-lg font-bold japanese-text">管理者プロフィール</h3>
            </div>
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-secondary-container flex items-center justify-center text-2xl font-bold text-on-secondary-container relative group">
                田
                <button className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary text-on-primary rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm">
                <div>
                  <p className="text-xs text-on-surface-variant font-bold">氏名</p>
                  <p className="font-bold text-[#1A1A2E]">田中 一郎</p>
                </div>
                <div>
                  <p className="text-xs text-on-surface-variant font-bold">役職</p>
                  <p className="font-bold text-[#1A1A2E]">Senior Manager</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-on-surface-variant font-bold">メールアドレス</p>
                  <p className="font-bold text-[#1A1A2E]">ichiro.tanaka@insight-studio.jp</p>
                </div>
              </div>
            </div>
          </div>

          {/* System Settings */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-secondary">tune</span>
              <h3 className="text-lg font-bold japanese-text">システム環境設定</h3>
            </div>
            {[
              { label: '自動アーカイブ', desc: '30日以上経過したレポートを自動的にアーカイブします。', checked: autoArchive, onChange: setAutoArchive },
              { label: '通知設定', desc: '分析完了時にメール通知を受け取ります。', checked: notifications, onChange: setNotifications },
              { label: 'データ連携', desc: '外部広告プラットフォームとのAPI連携を許可します。', checked: dataSync, onChange: setDataSync },
            ].map((setting) => (
              <div key={setting.label} className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm japanese-text">{setting.label}</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">{setting.desc}</p>
                </div>
                <Toggle checked={setting.checked} onChange={setting.onChange} />
              </div>
            ))}
          </div>

          {/* Security */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-secondary">shield</span>
              <h3 className="text-lg font-bold japanese-text">セキュリティ</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-container rounded-xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-surface-container-high rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary">database</span>
                </div>
                <div>
                  <p className="font-bold text-sm">BigQuery連携設定</p>
                  <p className="text-xs text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
                  </p>
                </div>
              </div>
              <div className="bg-surface-container rounded-xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-surface-container-high rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary">verified_user</span>
                </div>
                <div>
                  <p className="font-bold text-sm">二要素認証</p>
                  <p className="text-xs text-emerald-600 font-bold flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-span-5 space-y-8">
          {/* Report History */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">history</span>
                <h3 className="text-lg font-bold japanese-text">レポート履歴</h3>
              </div>
              <button className="text-sm font-bold text-secondary hover:underline">すべて見る</button>
            </div>
            <div className="space-y-4">
              {[
                { icon: 'picture_as_pdf', name: 'Q4 競合分析レポート', date: '2023.12.28', size: '12.4 MB', badge: 'PDF' },
                { icon: 'description', name: '広告運用パフォーマンス月報', date: '2023.12.01', size: '4.2 MB', badge: 'XLSX' },
                { icon: 'summarize', name: 'LP改善案サマリー', date: '2023.11.15', size: '8.7 MB', badge: 'PDF' },
              ].map((report) => (
                <div key={report.name} className="flex items-center gap-4 group">
                  <div className="w-12 h-12 bg-surface-container rounded-xl flex items-center justify-center text-on-surface-variant">
                    <span className="material-symbols-outlined">{report.icon}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm japanese-text">{report.name}</p>
                    <p className="text-xs text-on-surface-variant">生成日: {report.date} | {report.size}</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 bg-surface-container rounded">{report.badge}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Storage */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-secondary">cloud_done</span>
              <h3 className="text-lg font-bold japanese-text">ストレージ使用状況</h3>
            </div>
            <div className="h-3 bg-surface-container rounded-full overflow-hidden mb-3">
              <div className="h-full bg-secondary rounded-full" style={{ width: '65%' }} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-on-surface-variant">6.5 GB 使用済み</span>
              <span className="font-bold">10 GB 利用可能</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 text-sm text-emerald-700">
          <span className="material-symbols-outlined text-lg">check_circle</span>
          <span className="japanese-text">設定を保存しました</span>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex justify-end gap-4">
        <button className="px-8 py-3 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded-xl transition-all">
          キャンセル
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !isAdsAuthenticated}
          className="px-8 py-3 bg-primary text-on-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all shadow-xl shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              保存中…
            </>
          ) : '設定保存'}
        </button>
      </div>
    </div>
  )
}
