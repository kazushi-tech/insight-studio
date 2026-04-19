import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsightTurnCard from '../InsightTurnCard'
import styles from '../AiExplorerV2.module.css'

/**
 * Spy on MarkdownRenderer to verify the correct variant is forwarded.
 * We don't want to depend on react-markdown's real render output for these
 * props-level assertions.
 */
vi.mock('../../../MarkdownRenderer', () => ({
  default: vi.fn(({ content, variant, size }) => (
    <div data-testid="markdown-renderer" data-variant={variant} data-size={size}>
      {content}
    </div>
  )),
}))

describe('InsightTurnCard', () => {
  it('renders AI content via MarkdownRenderer with variant="ai-insight"', () => {
    render(
      <InsightTurnCard
        turn={{
          userPrompt: '直近のCVRの要因を教えて',
          aiContent: '## 分析結果\n- CTR上昇',
        }}
        size="large"
      />,
    )

    const md = screen.getByTestId('markdown-renderer')
    expect(md).toBeInTheDocument()
    expect(md).toHaveAttribute('data-variant', 'ai-insight')
    expect(md).toHaveAttribute('data-size', 'large')
    expect(md.textContent).toContain('## 分析結果')
  })

  it('shows the "AI 考察エンジン" label and aiTimestamp when provided', () => {
    render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'a',
          aiTimestamp: '2026-04-19 12:34',
        }}
      />,
    )
    expect(screen.getByText('AI 考察エンジン')).toBeInTheDocument()
    expect(screen.getByText('2026-04-19 12:34')).toBeInTheDocument()
  })

  it('applies the error class when turn.isError is true', () => {
    const { container } = render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'エラーが発生しました',
          isError: true,
        }}
      />,
    )
    const card = container.querySelector('[data-testid="insight-turn-card"]')
    expect(card).toBeInTheDocument()
    expect(card.className).toContain(styles.turnCardError)
  })

  it('omits the error class when turn.isError is false', () => {
    const { container } = render(
      <InsightTurnCard
        turn={{
          userPrompt: 'q',
          aiContent: 'ok',
        }}
      />,
    )
    const card = container.querySelector('[data-testid="insight-turn-card"]')
    expect(card.className).not.toContain(styles.turnCardError)
  })
})
