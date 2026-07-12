import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll } from 'vitest'
import { server } from './mocks/server.js'

class TestIntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }

  observe(target) {
    this.callback([{
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    }], this)
  }

  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

globalThis.IntersectionObserver ??= TestIntersectionObserver

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())
