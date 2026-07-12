import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ReportQuestionPanel from '../ReportQuestionPanel'
import { REPORT_QUESTION_FALLBACK } from '../reportQuestionContract'

const evidence = [
  { key: 'metric:sessions', title: 'GA4 chart_01 のPV', theme: 'traffic' },
]

function renderPanel({
  reportId = 'saved-report-1',
  reportsApi = { askProjectReportQuestion: vi.fn() },
} = {}) {
  return {
    reportsApi,
    ...render(
      <>
        <ReportQuestionPanel
          projectRef="project-one"
          reportId={reportId}
          evidence={evidence}
          open
          onOpenChange={vi.fn()}
          reportsApi={reportsApi}
        />
        <div id="report-evidence-1">根拠の表示先</div>
      </>,
    ),
  }
}

describe('ReportQuestionPanel', () => {
  it('asks from the saved report and renders only customer-safe cited evidence', async () => {
    const user = userEvent.setup()
    const reportsApi = {
      askProjectReportQuestion: vi.fn().mockResolvedValue({
        ok: true,
        answer: {
          answerable: true,
          text: 'GA4のPVは120sessionsです。datasetは確認済みです。',
          confidence: 'high',
          citations: [{ evidence_key: 'metric:sessions', title: 'chart_01' }],
          reason: null,
        },
      }),
    }
    const { container } = renderPanel({ reportsApi })

    await user.selectOptions(
      screen.getByLabelText('質問例から選ぶ'),
      '今回、どの数字が変わりましたか',
    )
    await user.click(screen.getByRole('button', { name: 'このレポートから回答する' }))

    expect(reportsApi.askProjectReportQuestion).toHaveBeenCalledWith(
      'project-one',
      'saved-report-1',
      '今回、どの数字が変わりましたか',
    )
    expect(screen.getByText(/サイト計測の見られた回数は120訪問/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /根拠を見る/ })).toHaveAttribute(
      'href',
      '#report-evidence-1',
    )
    expect(container.textContent).not.toMatch(
      /GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key|APIキー/i,
    )
  })

  it('shows the exact safe fallback when the report cannot support an answer', async () => {
    const user = userEvent.setup()
    const reportsApi = {
      askProjectReportQuestion: vi.fn().mockResolvedValue({
        ok: true,
        answer: {
          answerable: false,
          text: REPORT_QUESTION_FALLBACK,
          confidence: 'low',
          citations: [],
          reason: 'unsupported_or_causal_question',
        },
      }),
    }
    renderPanel({ reportsApi })

    await user.type(screen.getByLabelText('AIに聞きたいこと'), '広告の成果を教えて')
    await user.click(screen.getByRole('button', { name: 'このレポートから回答する' }))

    expect(screen.getByText(REPORT_QUESTION_FALLBACK)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /根拠を見る/ })).not.toBeInTheDocument()
  })

  it('rejects an answer whose citation is not in the displayed evidence', async () => {
    const user = userEvent.setup()
    const reportsApi = {
      askProjectReportQuestion: vi.fn().mockResolvedValue({
        answer: {
          answerable: true,
          text: '断定的な回答',
          citations: [{ evidence_key: 'unknown:evidence', title: '不明' }],
        },
      }),
    }
    renderPanel({ reportsApi })

    await user.type(screen.getByLabelText('AIに聞きたいこと'), '変化を教えて')
    await user.click(screen.getByRole('button', { name: 'このレポートから回答する' }))

    expect(screen.getByText(REPORT_QUESTION_FALLBACK)).toBeInTheDocument()
    expect(screen.queryByText('断定的な回答')).not.toBeInTheDocument()
  })

  it('never displays a raw backend error', async () => {
    const user = userEvent.setup()
    const reportsApi = {
      askProjectReportQuestion: vi.fn().mockRejectedValue(
        new Error('SQL dataset secret at C:\\private\\query.sql'),
      ),
    }
    const { container } = renderPanel({ reportsApi })

    await user.type(screen.getByLabelText('AIに聞きたいこと'), '変化を教えて')
    await user.click(screen.getByRole('button', { name: 'このレポートから回答する' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'AIへの質問を送信できませんでした。時間をおいて、もう一度お試しください。',
    )
    expect(container.textContent).not.toMatch(/SQL|dataset|secret|private|query\.sql/i)
  })

  it('does not expose a question form or call the API before server persistence', () => {
    const reportsApi = { askProjectReportQuestion: vi.fn() }
    renderPanel({ reportId: '', reportsApi })

    expect(screen.getByText('先にこのレポートを履歴へ保存してください。')).toBeInTheDocument()
    expect(screen.queryByLabelText('AIに聞きたいこと')).not.toBeInTheDocument()
    expect(reportsApi.askProjectReportQuestion).not.toHaveBeenCalled()
  })
})
