import { describe, it, expect } from 'vitest'

describe('Test infrastructure sanity check', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('jsdom is available', () => {
    expect(typeof document).toBe('object')
    expect(typeof window).toBe('object')
  })

  it('jest-dom matchers work', () => {
    const div = document.createElement('div')
    div.textContent = 'hello'
    document.body.appendChild(div)
    expect(div).toBeInTheDocument()
    document.body.removeChild(div)
  })
})
