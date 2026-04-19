import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PeriodSelector from '../PeriodSelector'

describe('PeriodSelector', () => {
  it('renders the trigger button', () => {
    render(<PeriodSelector />)
    const trigger = screen.getByRole('button', { name: /期間を選択/ })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the popover when trigger is clicked', () => {
    render(<PeriodSelector />)
    const trigger = screen.getByRole('button', { name: /期間を選択/ })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByTestId('period-selector-popover')
    expect(popover).toBeInTheDocument()
    // Presets are visible within the popover (trigger itself also shows the
    // active preset label; query within the popover to disambiguate).
    expect(popover.textContent).toContain('過去7日')
    expect(popover.textContent).toContain('過去30日')
    expect(popover.textContent).toContain('過去90日')
    expect(popover.textContent).toContain('今四半期')
    expect(popover.textContent).toContain('カスタム')
  })

  it('closes the popover on outside click', () => {
    render(
      <div>
        <PeriodSelector />
        <div data-testid="outside">outside</div>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: /期間を選択/ })
    fireEvent.click(trigger)
    expect(screen.getByTestId('period-selector-popover')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('period-selector-popover')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
