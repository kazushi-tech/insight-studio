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
    <div className="p-10 max-w-[800px] mx-auto space-y-10">
      <div>
        <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">設定</h2>
        <p className="text-on-surface-variant mt-2 text-sm">考察スタジオの動作に関わるシステム設定を管理できます。</p>
      </div>

      {!isAdsAuthenticated && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">設定の読み込み・保存には考察スタジオへのログインが必要です。</span>
        </div>
      )}

      {/* System Settings */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-secondary">tune</span>
          <h3 className="text-lg font-bold japanese-text">システム環境設定</h3>
        </div>
        {configLoading ? (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant py-4">
            <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
            設定を読み込み中…
          </div>
        ) : (
          <>
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
          </>
        )}
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
      <div className="flex justify-end">
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
