import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SourceBadge from '../SourceBadge'

describe('SourceBadge', () => {
  it('labels demo fixture data without implying a GA4 connection', () => {
    render(<SourceBadge source="demo" />)

    expect(screen.getByText('完全架空データ')).toBeInTheDocument()
    expect(screen.queryByText('サイト計測データ')).not.toBeInTheDocument()
  })
})
