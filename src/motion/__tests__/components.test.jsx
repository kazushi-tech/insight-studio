import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MotionPage from '../MotionPage'
import MotionProvider from '../MotionProvider'
import MotionReveal from '../MotionReveal'

describe('motion foundation components', () => {
  it('renders slim motion components under async strict LazyMotion', async () => {
    render(
      <MotionProvider>
        <MotionPage data-testid="motion-page">
          <MotionReveal data-testid="motion-reveal">結果を表示</MotionReveal>
        </MotionPage>
      </MotionProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('motion-page')).toBeInTheDocument())
    expect(screen.getByTestId('motion-reveal')).toHaveTextContent('結果を表示')
  })
})
