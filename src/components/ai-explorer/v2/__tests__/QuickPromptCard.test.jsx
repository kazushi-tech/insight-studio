import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuickPromptCard from '../QuickPromptCard'

describe('QuickPromptCard', () => {
  it('renders title and description', () => {
    render(
      <QuickPromptCard
        icon="lightbulb"
        title="流入チャネル分析"
        description="CVR・CPA の観点から効率的なチャネルを特定します。"
        onClick={() => {}}
      />,
    )
    expect(screen.getByText('流入チャネル分析')).toBeInTheDocument()
    expect(screen.getByText(/CVR・CPA/)).toBeInTheDocument()
  })

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn()
    render(
      <QuickPromptCard
        icon="warning"
        title="流出ポイント"
        description="離脱率を分析します。"
        onClick={onClick}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is true', () => {
    const onClick = vi.fn()
    render(
      <QuickPromptCard
        icon="warning"
        title="無効カード"
        description="使えません。"
        onClick={onClick}
        disabled
      />,
    )
    const btn = screen.getByRole('button', { name: '無効カード' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})
