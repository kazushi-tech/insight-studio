import { useCallback, useEffect, useState } from 'react'

import { billingApi } from '../api/billing'
import DataStatePanel from './DataStatePanel'


const STATUS_LABELS = {
  none: '未契約',
  managed_pilot: '有料パイロット',
  active: '利用中',
  trialing: 'トライアル中',
  past_due: 'お支払い確認中',
  canceled: '解約済み',
  unpaid: 'お支払い未完了',
}

const ACCESS_LABELS = {
  full: 'すべて利用できます',
  read_only: '閲覧のみ利用できます',
  export_only: '履歴の閲覧と出力のみ利用できます',
  blocked: '現在は利用できません',
}

function safeHostedUrl(value) {
  const parsed = new URL(String(value || ''))
  if (parsed.protocol !== 'https:') throw new Error('unsafe_billing_redirect')
  return parsed.href
}

function requestKey(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${id}`
}

export default function BillingSettingsCard({ user, enabled }) {
  const role = user?.platform_role ?? user?.workspace_role ?? user?.role
  const canManage = role === 'platform_admin' || role === 'workspace_owner'
  const [subscription, setSubscription] = useState(null)
  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('')
  const [redirecting, setRedirecting] = useState(false)

  const load = useCallback(async () => {
    if (!enabled || !canManage) return
    setState('loading')
    setMessage('')
    try {
      const response = await billingApi.getSubscription()
      setSubscription(response.subscription ?? response.entitlement ?? null)
      setState('ready')
    } catch {
      setState('error')
      setMessage('契約状況を確認できませんでした。少し待って再試行してください。')
    }
  }, [canManage, enabled])

  useEffect(() => {
    if (!enabled || !canManage) return undefined
    let active = true
    billingApi.getSubscription()
      .then((response) => {
        if (!active) return
        setSubscription(response.subscription ?? response.entitlement ?? null)
        setState('ready')
      })
      .catch(() => {
        if (!active) return
        setState('error')
        setMessage('契約状況を確認できませんでした。少し待って再試行してください。')
      })
    return () => { active = false }
  }, [canManage, enabled])

  if (!enabled || !canManage) return null

  async function redirect(action) {
    setRedirecting(true)
    setMessage('')
    try {
      const response = action === 'checkout'
        ? await billingApi.createCheckoutSession(
            import.meta.env.VITE_BILLING_PLAN_KEY || 'starter',
            { idempotencyKey: requestKey('checkout') },
          )
        : await billingApi.createPortalSession({ idempotencyKey: requestKey('portal') })
      window.location.assign(safeHostedUrl(response.url))
    } catch {
      setMessage(
        action === 'checkout'
          ? '申込みを開始できませんでした。規約への同意と設定状況を確認してください。'
          : '契約管理画面を開けませんでした。少し待って再試行してください。',
      )
    } finally {
      setRedirecting(false)
    }
  }

  return (
    <section className="space-y-5 rounded-2xl bg-surface-container-lowest p-5 shadow-sm sm:p-6" aria-labelledby="billing-settings-title">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-secondary" aria-hidden="true">payments</span>
        <div>
          <h2 id="billing-settings-title" className="text-lg font-extrabold text-on-surface japanese-text">契約とお支払い</h2>
          <p className="mt-1 text-sm text-on-surface-variant japanese-text">カード情報はInsight Studioでは保持しません。安全な決済画面で管理します。</p>
        </div>
      </div>

      {state === 'loading' && <DataStatePanel state="loading" message="契約状況を確認しています。" />}
      {state === 'error' && <DataStatePanel state="error" message={message} onRetry={load} />}
      {state === 'ready' && (
        <>
          <div className="rounded-xl bg-surface-container p-4">
            <p className="text-xs font-bold text-on-surface-variant japanese-text">現在の状態</p>
            <p className="mt-1 text-lg font-extrabold text-on-surface japanese-text">
              {STATUS_LABELS[subscription?.status] || '確認が必要です'}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant japanese-text">
              {ACCESS_LABELS[subscription?.access] || '利用状態を確認できません。'}
            </p>
          </div>
          {message && <p role="alert" className="rounded-xl bg-error-container px-4 py-3 text-sm font-bold text-on-error-container japanese-text">{message}</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            {subscription?.status === 'none' || subscription?.access === 'blocked' ? (
              <button
                type="button"
                onClick={() => redirect('checkout')}
                disabled={redirecting}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-black text-on-primary disabled:opacity-50"
              >
                安全な申込み画面へ
              </button>
            ) : (
              <button
                type="button"
                onClick={() => redirect('portal')}
                disabled={redirecting || subscription?.status === 'managed_pilot'}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-black text-on-primary disabled:opacity-50"
              >
                請求・解約を管理
              </button>
            )}
            <button type="button" onClick={load} disabled={redirecting} className="min-h-11 rounded-xl px-5 text-sm font-bold text-primary hover:bg-primary/5 disabled:opacity-50">
              状態を再確認
            </button>
          </div>
          {subscription?.status === 'managed_pilot' && (
            <p className="text-xs font-bold text-on-surface-variant japanese-text">有料パイロットは自動課金へ切り替わりません。変更は担当者へご連絡ください。</p>
          )}
        </>
      )}
    </section>
  )
}
