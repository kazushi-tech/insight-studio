import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('renders a focused empty state without the removed top panels', () => {
    render(<InsightTimeline {...baseProps} />)
    expect(screen.queryByTestId('insight-decision-board')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ads-ai-setup-guide')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-explorer-v2-empty')).toBeInTheDocument()
    expect(screen.getByText('AI考察を始めましょう')).toBeInTheDocument()
    expect(screen.getByText('CV悪化の原因を特定')).toBeInTheDocument()
    expect(screen.getByText('CPA改善の優先施策')).toBeInTheDocument()
    expect(screen.getByText('流入チャネル別の勝ち筋')).toBeInTheDocument()
    expect(screen.getByText('LP/広告/配信設定のどこを直すべきか')).toBeInTheDocument()
    expect(screen.queryByText('参照データ')).not.toBeInTheDocument()
    expect(screen.queryByText('文字サイズ')).not.toBeInTheDocument()
    expect(screen.queryByText('チャット消去')).not.toBeInTheDocument()
    expect(screen.queryByText('コンテキスト更新')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-session-toolbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'セッションをクリア' })).toBeDisabled()
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
    expect(screen.getByText('2件のやり取りを保持中。精度を戻すなら新しいセッションで聞き直せます。')).toBeInTheDocument()
  })

  it('calls onClearChat from the visible session clear button', async () => {
    const user = userEvent.setup()
    const onClearChat = vi.fn()
    render(
      <InsightTimeline
        {...baseProps}
        onClearChat={onClearChat}
        messages={[
          { role: 'user', text: '質問' },
          { role: 'assistant', text: '回答' },
        ]}
      />,
    )

    await user.click(screen.getByText('セッションをクリア'))
    expect(onClearChat).toHaveBeenCalledTimes(1)
  })

  it('shows the loading skeleton when there is a pending user message', () => {
    const messages = [{ role: 'user', text: '生成中の質問' }]
    render(<InsightTimeline {...baseProps} messages={messages} loading />)
    expect(screen.getByRole('status', { name: '考察を生成中' })).toBeInTheDocument()
    expect(screen.getByText('考察を生成中です… ✨')).toBeInTheDocument()
  })

  it('does not keep a stale pending skeleton when loading is false', () => {
    const messages = [{ role: 'user', text: '前回リロード時に残った質問' }]
    render(<InsightTimeline {...baseProps} messages={messages} loading={false} />)

    expect(screen.queryByRole('status', { name: '考察を生成中' })).not.toBeInTheDocument()
    expect(screen.queryByText('考察を生成中です… ✨')).not.toBeInTheDocument()
    expect(screen.queryByTestId('insight-turn-card')).not.toBeInTheDocument()
  })

  it('shows the composer placeholder text', () => {
    render(<InsightTimeline {...baseProps} />)
    expect(
      screen.getByPlaceholderText('データに対する質問や分析したい仮説を入力してください…'),
    ).toBeInTheDocument()
  })
})
