import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarkdownRenderer from '../MarkdownRenderer'

// Mock ChartGroupCard so we don't need chart.js DOM plumbing; just verify the
// group payload is passed through.
vi.mock('../ads/ChartGroupCard', () => ({
  default: vi.fn(({ group }) => (
    <div data-testid="chart-group-card" data-title={group?.title ?? ''} />
  )),
}))

describe('MarkdownRenderer — chart fence handling', () => {
  it('renders a ChartGroupCard from a ```chart fenced block with valid JSON', () => {
    const payload = {
      title: 'CVR推移',
      labels: ['W1', 'W2'],
      datasets: [{ label: 'CVR', data: [1, 2] }],
      chartType: 'line',
    }
    const content = '# 分析\n\n```chart\n' + JSON.stringify(payload) + '\n```\n'
    render(<MarkdownRenderer content={content} variant="ai-insight" />)

    const card = screen.getByTestId('chart-group-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveAttribute('data-title', 'CVR推移')
  })

  it('also renders a ChartGroupCard from a plain JSON code fence whose body has labels and datasets', () => {
    const payload = {
      title: 'セッション推移',
      labels: ['M', 'T'],
      datasets: [{ label: 'sessions', data: [10, 20] }],
    }
    const content = '```json\n' + JSON.stringify(payload) + '\n```\n'
    render(<MarkdownRenderer content={content} variant="discovery" />)

    const card = screen.getByTestId('chart-group-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveAttribute('data-title', 'セッション推移')
  })

  it('falls back to <pre> when ```chart body is invalid JSON (no crash)', () => {
    const content = '```chart\n{ this is : not json ,,,\n```\n'
    const { container } = render(<MarkdownRenderer content={content} variant="ai-insight" />)

    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('falls back to <pre> when chart JSON is missing required keys', () => {
    const content = '```chart\n{"title": "incomplete"}\n```\n'
    const { container } = render(<MarkdownRenderer content={content} variant="ai-insight" />)

    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('preserves regular code fences as <pre>', () => {
    const content = '```python\nprint("hello")\n```\n'
    const { container } = render(<MarkdownRenderer content={content} />)

    expect(screen.queryByTestId('chart-group-card')).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})
