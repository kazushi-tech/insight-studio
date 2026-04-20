import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReportHistoryDrawer from '../ReportHistoryDrawer'
import { useReportHistory } from '../../../contexts/ReportHistoryContext'

vi.mock('../../../contexts/ReportHistoryContext', () => ({
  useReportHistory: vi.fn(),
}))

vi.mock('../../MarkdownRenderer', () => ({
  default: ({ content }) => <div data-testid="markdown">{content}</div>,
}))

function makeEntry(overrides = {}) {
  return {
    id: overrides.id ?? 'entry-1',
    version: 1,
    caseId: 'petabit',
    createdAt: '2026-04-15T05:32:00.000Z',
    setupState: { periods: ['2024-10'], queryTypes: ['search'], granularity: 'monthly' },
    reportBundle: { reportMd: '# ヘッドライン\n詳細本文', chartGroups: [] },
    messages: [{ role: 'user', text: 'hi' }],
    contextMode: 'ads-only',
    metadata: {
      title: '4月15日 14:32',
      tldr: '離脱が増えています',
      messageCount: 1,
      periodsLabel: '2024-10',
      queryTypesLabel: '検索クエリ',
    },
    ...overrides,
  }
}

function setMock({
  history = [],
  removeEntry = vi.fn(),
  restoreEntry = vi.fn(),
  clearAll = vi.fn(),
  maxEntries = 20,
} = {}) {
  useReportHistory.mockReturnValue({
    history,
    removeEntry,
    restoreEntry,
    clearAll,
    maxEntries,
  })
  return { removeEntry, restoreEntry, clearAll }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportHistoryDrawer', () => {
  it('shows empty state when no history', () => {
    setMock({ history: [] })
    render(<ReportHistoryDrawer open onClose={vi.fn()} />)
    expect(screen.getByText('まだ履歴がありません')).toBeInTheDocument()
  })

  it('renders count badge with total and max', () => {
    setMock({ history: [makeEntry(), makeEntry({ id: 'entry-2' })] })
    render(<ReportHistoryDrawer open onClose={vi.fn()} />)
    expect(screen.getByText('2/20')).toBeInTheDocument()
  })

  it('renders one card per history entry', () => {
    setMock({ history: [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })] })
    render(<ReportHistoryDrawer open onClose={vi.fn()} />)
    const restoreButtons = screen.getAllByText('このレポートを復元')
    expect(restoreButtons).toHaveLength(2)
  })

  it('invokes onClose when × is clicked', () => {
    setMock({ history: [] })
    const onClose = vi.fn()
    render(<ReportHistoryDrawer open onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('レポート履歴を閉じる'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    setMock({ history: [] })
    const onClose = vi.fn()
    render(<ReportHistoryDrawer open onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls removeEntry with id when 削除 is clicked', () => {
    const { removeEntry } = setMock({ history: [makeEntry({ id: 'target' })] })
    render(<ReportHistoryDrawer open onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('この履歴を削除'))
    expect(removeEntry).toHaveBeenCalledWith('target')
  })

  it('calls restoreEntry after confirmation and closes drawer', () => {
    const { restoreEntry } = setMock({ history: [makeEntry({ id: 'x' })] })
    const onClose = vi.fn()
    render(<ReportHistoryDrawer open onClose={onClose} />)
    fireEvent.click(screen.getByText('このレポートを復元'))
    fireEvent.click(screen.getByText('復元する'))
    expect(restoreEntry).toHaveBeenCalledWith('x')
    expect(onClose).toHaveBeenCalled()
  })
})
