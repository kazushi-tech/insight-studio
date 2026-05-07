import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AiContextRail from '../AiContextRail'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/compare']}>
      <AiContextRail
        screenName="LP比較アシスタント"
        status="入力待ち"
        inputSummary="URL未入力"
        suggestedQuestions={['競合AがCVRで優位な理由を詳しく分析して']}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('AiContextRail', () => {
  it('does not navigate when the composer field is focused', async () => {
    const user = userEvent.setup()
    renderRail()

    await user.click(screen.getByPlaceholderText('質問を入力してください…'))

    expect(screen.getByTestId('location')).toHaveTextContent('/compare')
  })

  it('navigates to AI explorer only when a composed question is submitted', async () => {
    const user = userEvent.setup()
    renderRail()

    await user.type(screen.getByPlaceholderText('質問を入力してください…'), 'CTAの弱点を教えて')
    await user.click(screen.getByRole('button', { name: 'AI考察でこの質問を開く' }))

    expect(screen.getByTestId('location').textContent).toContain('/ads/ai?question=')
    expect(decodeURIComponent(screen.getByTestId('location').textContent)).toContain('CTAの弱点を教えて')
  })
})
