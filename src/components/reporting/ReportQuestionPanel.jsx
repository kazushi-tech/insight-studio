import { useEffect, useId, useMemo, useRef, useState } from 'react'
import * as defaultReportsApi from '../../api/projectReports'
import { sanitizeSharedReportText } from '../../utils/reportSharing'
import { REPORT_QUESTION_FALLBACK, reportEvidenceDomId } from './reportQuestionContract'

const QUESTION_EXAMPLES = [
  '今回、どの数字が変わりましたか',
  '今後、確認する数字を教えてください',
  'この結論を支える数字を説明してください',
]

function safeAnswer(payload, evidence) {
  const answer = payload?.answer
  if (!answer?.answerable) {
    return { text: REPORT_QUESTION_FALLBACK, citations: [], answerable: false }
  }

  const knownEvidence = new Map(
    (Array.isArray(evidence) ? evidence : []).map((item, index) => [
      item?.key,
      {
        domId: reportEvidenceDomId(index),
        title: sanitizeSharedReportText(item?.title, `数字の根拠 ${index + 1}`),
      },
    ]),
  )
  const seen = new Set()
  const citations = (Array.isArray(answer.citations) ? answer.citations : [])
    .map((citation) => {
      const local = knownEvidence.get(citation?.evidence_key)
      if (!local || seen.has(local.domId)) return null
      seen.add(local.domId)
      return local
    })
    .filter(Boolean)
  const text = sanitizeSharedReportText(answer.text, REPORT_QUESTION_FALLBACK)

  if (!text || citations.length === 0) {
    return { text: REPORT_QUESTION_FALLBACK, citations: [], answerable: false }
  }
  return { text, citations, answerable: true }
}

function ReportQuestionPanelState({
  projectRef,
  reportId,
  evidence = [],
  open = false,
  onOpenChange = () => {},
  reportsApi = defaultReportsApi,
}) {
  const selectId = useId()
  const questionId = useId()
  const answerRef = useRef(null)
  const requestSequence = useRef(0)
  const [selectedExample, setSelectedExample] = useState('')
  const [question, setQuestion] = useState('')
  const [status, setStatus] = useState('idle')
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState('')
  const canAsk = Boolean(projectRef && reportId)

  useEffect(() => {
    if (status === 'ready') answerRef.current?.focus()
  }, [status])

  const remainingCharacters = 2_000 - question.length
  const evidenceCount = useMemo(
    () => new Set(evidence.map((item) => item?.key).filter(Boolean)).size,
    [evidence],
  )

  function handleExampleChange(event) {
    const next = event.target.value
    setSelectedExample(next)
    if (next) setQuestion(next)
    setAnswer(null)
    setError('')
    setStatus('idle')
  }

  function handleQuestionChange(event) {
    const next = event.target.value.slice(0, 2_000)
    setQuestion(next)
    if (next !== selectedExample) setSelectedExample('')
    setAnswer(null)
    setError('')
    setStatus('idle')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedQuestion = question.trim()
    if (!canAsk || !normalizedQuestion || status === 'loading') return

    const sequence = ++requestSequence.current
    setStatus('loading')
    setAnswer(null)
    setError('')
    try {
      const response = await reportsApi.askProjectReportQuestion(
        projectRef,
        reportId,
        normalizedQuestion,
      )
      if (sequence !== requestSequence.current) return
      setAnswer(safeAnswer(response, evidence))
      setStatus('ready')
    } catch {
      if (sequence !== requestSequence.current) return
      setError('AIへの質問を送信できませんでした。時間をおいて、もう一度お試しください。')
      setStatus('error')
    }
  }

  return (
    <aside
      id="report-question-panel"
      className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm"
      aria-labelledby="report-question-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">Question</p>
          <h2 id="report-question-title" className="mt-1 text-base font-extrabold text-on-surface japanese-text">
            数字を確認してからAIに質問
          </h2>
        </div>
        {open && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="AIへの質問を閉じる"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
        保存済みのレポートだけを読み、確認できる数字と根拠を添えて回答します。
      </p>

      {!open && (
        <p className="mt-4 rounded-xl bg-surface-container-low px-4 py-3 text-xs font-bold leading-6 text-on-surface-variant japanese-text">
          質問するときだけ上の「この結果をAIに聞く」から開けます。
        </p>
      )}

      {open && !canAsk && (
        <div className="mt-4 rounded-xl bg-warning-container/70 px-4 py-3" role="status">
          <p className="text-sm font-extrabold text-on-surface japanese-text">先にこのレポートを履歴へ保存してください。</p>
          <p className="mt-1 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
            保存が完了すると、別の端末でも同じ内容をもとに質問できます。
          </p>
        </div>
      )}

      {open && canAsk && (
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor={selectId} className="text-sm font-extrabold text-on-surface japanese-text">
              質問例から選ぶ
            </label>
            <select
              id={selectId}
              value={selectedExample}
              onChange={handleExampleChange}
              className="mt-2 min-h-11 w-full rounded-xl bg-surface-container-low px-3 py-2 text-sm font-bold text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">自分で質問を書く</option>
              {QUESTION_EXAMPLES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={questionId} className="text-sm font-extrabold text-on-surface japanese-text">
              AIに聞きたいこと
            </label>
            <textarea
              id={questionId}
              value={question}
              onChange={handleQuestionChange}
              maxLength={2_000}
              rows={4}
              placeholder="例: 今回、どの数字が変わりましたか"
              className="mt-2 min-h-28 w-full resize-y rounded-xl bg-surface-container-low px-3 py-3 text-sm font-semibold leading-6 text-on-surface placeholder:text-on-surface-variant/70 focus-visible:outline-2 focus-visible:outline-primary"
              aria-describedby={`${questionId}-help`}
            />
            <p id={`${questionId}-help`} className="mt-1 text-right text-[11px] font-bold text-on-surface-variant">
              あと{remainingCharacters.toLocaleString('ja-JP')}文字
            </p>
          </div>
          <button
            type="submit"
            disabled={!question.trim() || status === 'loading' || evidenceCount === 0}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">auto_awesome</span>
            {status === 'loading' ? '根拠を確認中' : 'このレポートから回答する'}
          </button>
        </form>
      )}

      {open && canAsk && evidenceCount === 0 && (
        <p className="mt-4 rounded-xl bg-warning-container/70 px-4 py-3 text-sm font-bold leading-6 text-on-surface japanese-text" role="status">
          {REPORT_QUESTION_FALLBACK}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-error-container px-4 py-3 text-sm font-bold leading-6 text-on-error-container japanese-text" role="alert">
          {error}
        </p>
      )}

      {answer && (
        <div
          ref={answerRef}
          tabIndex={-1}
          className="mt-4 rounded-xl bg-primary/[0.06] px-4 py-4 focus-visible:outline-2 focus-visible:outline-primary"
          role="status"
          aria-live="polite"
        >
          <h3 className="text-sm font-extrabold text-on-surface japanese-text">AIからの回答</h3>
          <p className="mt-2 text-sm font-semibold leading-7 text-on-surface japanese-text">{answer.text}</p>
          {answer.answerable && (
            <ul className="mt-3 space-y-2" aria-label="回答に使った根拠">
              {answer.citations.map((citation) => (
                <li key={citation.domId}>
                  <a
                    href={`#${citation.domId}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-primary hover:bg-primary/[0.07] focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_downward</span>
                    根拠を見る: {citation.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}

export default function ReportQuestionPanel(props) {
  const scopeKey = `${props.projectRef || ''}:${props.reportId || ''}`
  return <ReportQuestionPanelState key={scopeKey} {...props} />
}
