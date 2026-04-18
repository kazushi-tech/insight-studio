import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PriorityActionHeroV2 from '../PriorityActionHeroV2'

describe('PriorityActionHeroV2', () => {
  it('renders up to 3 actions from ReportEnvelope', () => {
    const envelope = {
      priority_actions: [
        { title: 'CTA 改修', detail: 'メインCTAを明確化' },
        { title: '信頼構築', detail: '導入事例セクションを追加' },
        { title: 'FV 最適化', detail: 'KBF を上部に集約' },
        { title: '除外ワード', detail: '4番目は無視' },
      ],
    }
    render(<PriorityActionHeroV2 envelope={envelope} reportMd="" />)
    expect(screen.getByText('CTA 改修')).toBeInTheDocument()
    expect(screen.getByText('信頼構築')).toBeInTheDocument()
    expect(screen.getByText('FV 最適化')).toBeInTheDocument()
    expect(screen.queryByText('除外ワード')).not.toBeInTheDocument()
  })

  it('falls back to markdown parsing when envelope is null', () => {
    const md = `## 最優先施策

- CTA改修: メインCTAを明確化
- 信頼構築: 導入事例セクションを追加
- FV最適化: KBFを上部に集約
`
    render(<PriorityActionHeroV2 envelope={null} reportMd={md} />)
    expect(screen.getByText('CTA改修')).toBeInTheDocument()
    expect(screen.getByText('信頼構築')).toBeInTheDocument()
    expect(screen.getByText('FV最適化')).toBeInTheDocument()
  })

  it('renders nothing when neither envelope nor markdown has actions', () => {
    const { container } = render(<PriorityActionHeroV2 envelope={null} reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
