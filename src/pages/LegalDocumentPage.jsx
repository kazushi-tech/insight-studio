import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { legalApi } from '../api/legal'
import DataStatePanel from '../components/DataStatePanel'


const DOCUMENTS = {
  terms: { title: '利用規約', key: 'terms' },
  privacy: { title: 'プライバシーポリシー', key: 'privacy' },
  'commercial-transactions': { title: '特定商取引法に基づく表記', key: 'commercial_transactions' },
  security: { title: 'セキュリティ', key: 'security' },
  subprocessors: { title: '外部委託先', key: 'subprocessors' },
}
export default function LegalDocumentPage({ document }) {
  const definition = DOCUMENTS[document] || DOCUMENTS.terms
  const [documents, setDocuments] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let active = true
    legalApi.getDocuments()
      .then((response) => {
        if (!active) return
        setDocuments(Array.isArray(response.documents) ? response.documents : [])
        setState('ready')
      })
      .catch(() => {
        if (!active) return
        setState('error')
      })
    return () => { active = false }
  }, [])

  const current = useMemo(
    () => documents?.find((item) => item.document_key === definition.key) ?? null,
    [definition.key, documents],
  )

  return (
    <main className="min-h-screen bg-surface px-4 py-10 text-on-surface sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-7">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-primary hover:bg-primary/5">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          Insight Studioへ戻る
        </Link>
        <header>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Legal</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight japanese-text">{definition.title}</h1>
        </header>

        {state === 'loading' && <DataStatePanel state="loading" message="承認済み文書を確認しています。" />}
        {state === 'error' && (
          <DataStatePanel
            state="error"
            title="承認済み文書はまだ公開されていません"
            message="会社確認が完了するまで、この文書を推測で表示せず、申込みも開始しません。"
          />
        )}
        {state === 'ready' && !current && (
          <DataStatePanel
            state="empty"
            title="この文書は会社確認中です"
            message="承認済みの最新版が公開されるまでお待ちください。"
          />
        )}
        {current && (
          <section className="rounded-2xl bg-surface-container-lowest p-6 shadow-sm">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="font-bold text-on-surface-variant">版</dt><dd className="mt-1 font-extrabold">{current.version}</dd></div>
              <div><dt className="font-bold text-on-surface-variant">適用開始</dt><dd className="mt-1 font-extrabold">{current.effective_at ? new Date(current.effective_at).toLocaleDateString('ja-JP') : '公開文書で確認'}</dd></div>
            </dl>
            <p className="mt-5 text-sm leading-7 text-on-surface-variant japanese-text">
              会社承認済みの原文を別ページで表示します。この画面では文面を生成・改変しません。
            </p>
            <a
              href={current.public_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-black text-on-primary"
            >
              承認済み文書を開く
              <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
            </a>
          </section>
        )}
      </div>
    </main>
  )
}
