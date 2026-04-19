import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsightTimeline from '../InsightTimeline'

vi.mock('../../../MarkdownRenderer', () => ({
  default: vi.fn(({ content }) => (
    <div data-testid="markdown-renderer">{content}</div>
  )),
}))

// Simplify ui helpers so they don't pull in network mocks.
vi.mock('../../../ui', () => ({
  LoadingSpinner: ({ label }) => <div data-testid="loading-spinner">{label ?? ''}</div>,
  ErrorBanner: ({ message }) => <div data-testid="error-banner">{message}</div>,
}))

const baseProps = {
  messages: [],
  input: '',
  setInput: vi.fn(),
  onSend: vi.fn(),
  loading: false,
  promptDisabled: false,
  fontSize: 'normal',
  status: '',
  statusTone: '',
  statusIcon: 'info',
  contextMode: 'ads-only',
  setContextMode: vi.fn(),
  handleFontSizeChange: vi.fn(),
  mlIndicatorTone: '',
  mlIndicatorDot: '',
  mlIndicatorLabel: '',
  reportLoading: false,
  setupState: { queryTypes: [], periods: [] },
  isAdsAuthenticated: true,
  handleRefreshReport: vi.fn(),
  hasAnalysisKey: true,
  onClearChat: vi.fn(),
  mlStatus: 'idle',
  reportError: null,
  reportBundle: { reportMd: '# report' },
}

describe('InsightTimeline', () => {
  it('renders empty state with the three default quick prompts when no messages', () => {
    render(<InsightTimeline {...baseProps} />)
    expect(screen.getByTestId('ai-explorer-v2-empty')).toBeInTheDocument()
    expect(screen.getByText('AI考察を始めましょう')).toBeInTheDocument()
    expect(screen.getByText('コンバージョン流出ポイントを特定して')).toBeInTheDocument()
    expect(screen.getByText('最も効果的な流入チャネルとその理由')).toBeInTheDocument()
    expect(screen.getByText('期間比較で一番変化が大きい指標は？')).toBeInTheDocument()
  })

  it('renders an InsightTurnCard for each completed user/assistant pair', () => {
    const messages = [
      { role: 'user', text: '最初の質問' },
      { role: 'assistant', text: '## 分析\n- 内容' },
      { role: 'user', text: '次の質問' },
      { role: 'assistant', text: '## 次の分析\n- 詳細' },
    ]
    render(<InsightTimeline {...baseProps} messages={messages} />)
    const cards = screen.getAllByTestId('insight-turn-card')
    expect(cards).toHaveLength(2)
    // Skeleton should not render when loading=false and no pending turn.
    expect(screen.queryByRole('status', { name: '考察を生成中' })).not.toBeInTheDocument()
  })

  it('shows the loading skeleton when there is a pending user message', () => {
    const messages = [{ role: 'user', text: '生成中の質問' }]
    render(<InsightTimeline {...baseProps} messages={messages} loading />)
    expect(screen.getByRole('status', { name: '考察を生成中' })).toBeInTheDocument()
    expect(screen.getByText('考察を生成中です… ✨')).toBeInTheDocument()
  })

  it('shows the composer placeholder text', () => {
    render(<InsightTimeline {...baseProps} />)
    expect(
      screen.getByPlaceholderText('データに対する質問や分析したい仮説を入力してください…'),
    ).toBeInTheDocument()
  })
})
