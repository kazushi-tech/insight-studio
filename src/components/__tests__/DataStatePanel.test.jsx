import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DataStatePanel from '../DataStatePanel'

describe('DataStatePanel', () => {
  it('renders full content without an extra state wrapper', () => {
    render(<DataStatePanel state="full"><p>レポート本文</p></DataStatePanel>)
    expect(screen.getByText('レポート本文')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces partial data without treating it as an error', () => {
    render(<DataStatePanel state="partial" message="成果データは確認中です。" />)
    expect(screen.getByRole('status')).toHaveTextContent('確認できた範囲')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a 44px retry action for failures', () => {
    const onRetry = vi.fn()
    render(<DataStatePanel state="error" onRetry={onRetry} />)
    const button = screen.getByRole('button', { name: 'もう一度確認する' })
    expect(button.className).toContain('min-h-11')
    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
