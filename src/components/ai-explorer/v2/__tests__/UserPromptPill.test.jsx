import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserPromptPill from '../UserPromptPill'

describe('UserPromptPill', () => {
  it('renders the prompt content inside a button', () => {
    render(<UserPromptPill content="CVRの要因を説明して" />)
    const btn = screen.getByRole('button')
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toContain('CVRの要因を説明して')
  })

  it('toggles aria-expanded when clicked', () => {
    render(<UserPromptPill content="テスト質問" timestamp="2026-04-19 10:00" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows timestamp only when expanded', () => {
    render(<UserPromptPill content="テスト質問" timestamp="2026-04-19 10:00" />)
    expect(screen.queryByText('2026-04-19 10:00')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('2026-04-19 10:00')).toBeInTheDocument()
  })

  it('returns null when content is empty', () => {
    const { container } = render(<UserPromptPill content="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
