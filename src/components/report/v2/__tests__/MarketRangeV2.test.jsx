import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarketRangeV2 from '../MarketRangeV2'

const ENVELOPE = {
  market_estimate: {
    confidence: '高',
    ranges: [
      { label: '市場規模', min: 120000, max: 180000, unit: '百万円' },
      { label: '検索ボリューム', min: 8000, max: 12000, unit: '回/月' },
      { label: 'CPC', min: 250, max: 480, unit: '円' },
    ],
  },
}

const MD_FIXTURE = `## 3. 市場推定データ
**信頼度**: 中

| 指標 | レンジ | 単位 |
| --- | --- | --- |
| 市場規模 | 100000〜200000 | 百万円 |
| 検索ボリューム | 5000〜9000 | 回/月 |
`

describe('MarketRangeV2', () => {
  it('prefers envelope.market_estimate and surfaces ConfidencePill', () => {
    render(<MarketRangeV2 envelope={ENVELOPE} reportMd="" />)
    expect(screen.getByText('市場規模')).toBeInTheDocument()
    expect(screen.getByText('CPC')).toBeInTheDocument()
    expect(screen.getByLabelText('信頼度 高')).toBeInTheDocument()
  })

  it('falls back to markdown parsing when envelope is null', () => {
    render(<MarketRangeV2 envelope={null} reportMd={MD_FIXTURE} />)
    expect(screen.getByText('市場規模')).toBeInTheDocument()
    expect(screen.getByText('検索ボリューム')).toBeInTheDocument()
    expect(screen.getByLabelText('信頼度 中')).toBeInTheDocument()
  })

  it('renders nothing when neither envelope nor md has ranges', () => {
    const { container } = render(<MarketRangeV2 envelope={null} reportMd="# empty" />)
    expect(container).toBeEmptyDOMElement()
  })
})
