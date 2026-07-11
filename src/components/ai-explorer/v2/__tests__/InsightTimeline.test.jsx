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
    expect(screen.getByText('今回、何が起きているか教えて')).toBeInTheDocument()
    expect(screen.getByText('問い合わせにつながる動きを見たい')).toBeInTheDocument()
    expect(screen.getByText('よく見られたページで直す場所は？')).toBeInTheDocument()
    expect(screen.getByText('今日やることを3つに絞って')).toBeInTheDocument()
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
      screen.getByPlaceholderText('例: 今日やることを3つに絞って'),
    ).toBeInTheDocument()
  })

  it('does not show only the old format error for legacy saved sessions', () => {
    const messages = [
      { role: 'user', text: '5月のPV最大日は？' },
      { role: 'assistant', text: 'この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。' },
    ]
    render(<InsightTimeline {...baseProps} messages={messages} />)

    expect(screen.getByText(/古い形式の回答です/)).toBeInTheDocument()
    expect(screen.getByText(/再生成してください/)).toBeInTheDocument()
    expect(screen.queryByText(/^この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。$/)).not.toBeInTheDocument()
  })

  it('shows the fixed fictional answer notice only in demo mode', () => {
    const { rerender } = render(<InsightTimeline {...baseProps} hasAnalysisKey={false} isDemo />)

    expect(screen.getByTestId('demo-ai-notice')).toHaveTextContent('固定された架空回答')
    expect(screen.queryByText(/Geminiを設定すると/)).not.toBeInTheDocument()

    rerender(<InsightTimeline {...baseProps} hasAnalysisKey={false} isDemo={false} />)
    expect(screen.queryByTestId('demo-ai-notice')).not.toBeInTheDocument()
    expect(screen.getByText(/Geminiを設定すると/)).toBeInTheDocument()
  })
})
