import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PriorityActionHero from '../PriorityActionHero'

function renderWith(md) {
  return render(<PriorityActionHero reportMd={md} />)
}

describe('PriorityActionHero', () => {
  it('renders null when reportMd is not a string', () => {
    const { container } = renderWith(null)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when no action-like section is present', () => {
    const { container } = renderWith('## エグゼクティブサマリー\n本文のみ。')
    expect(container.firstChild).toBeNull()
  })

  it('detects the canonical `## 最優先施策` heading', () => {
    const md = `## 最優先施策\n- 施策A: 指名流入強化\n- 施策B: 比較導線整備\n- 施策C: 信頼訴求\n\n## 次セクション`
    const { getByLabelText, getAllByRole } = renderWith(md)
    expect(getByLabelText('最優先施策')).toBeTruthy()
    expect(getAllByRole('heading', { level: 4 })).toHaveLength(3)
  })

  it('detects `## 実行プラン`', () => {
    const md = `## 実行プラン\n1. 指名防衛\n2. カテゴリ獲得\n3. LP改善`
    const { queryByLabelText } = renderWith(md)
    expect(queryByLabelText('最優先施策')).toBeTruthy()
  })

  it('detects `## アクションプラン` (backend alias)', () => {
    const md = `## アクションプラン\n- 施策A\n- 施策B\n- 施策C`
    const { queryByLabelText } = renderWith(md)
    expect(queryByLabelText('最優先施策')).toBeTruthy()
  })

  it('detects `## 広告運用アクションプラン` (legacy heading)', () => {
    const md = `## 広告運用アクションプラン\n- 施策A\n- 施策B\n- 施策C`
    const { queryByLabelText } = renderWith(md)
    expect(queryByLabelText('最優先施策')).toBeTruthy()
  })

  it('detects `## 改善提案`', () => {
    const md = `## 改善提案\n- LP改善\n- 広告コピー刷新\n- 入札戦略見直し`
    const { queryByLabelText } = renderWith(md)
    expect(queryByLabelText('最優先施策')).toBeTruthy()
  })

  it('detects numbered heading like `## 5. 実行プラン`', () => {
    const md = `## 5. 実行プラン\n- 施策A\n- 施策B`
    const { queryByLabelText } = renderWith(md)
    expect(queryByLabelText('最優先施策')).toBeTruthy()
  })

  it('does not match sub-numbered headings like `## 5-1. LP改善施策`', () => {
    // Backend quality gate matches "施策" broadly, but the hero should not
    // hijack sub-sections — PRD treats 5-1 as a Section-5 child, not an action list.
    const md = `## 5-1. LP改善施策\n- サブ項目A\n- サブ項目B`
    const { container } = renderWith(md)
    expect(container.firstChild).toBeNull()
  })
})
