import { describe, expect, it } from 'vitest'
import {
  MOTION_DURATION,
  MOTION_STAGGER,
  PAGE_MOTION_VARIANTS,
  REDUCED_PAGE_MOTION_VARIANTS,
  REDUCED_REVEAL_MOTION_VARIANTS,
  staggerDelay,
} from '../tokens'

describe('motion tokens', () => {
  it('keeps interaction motion at or below 300ms', () => {
    expect(MOTION_DURATION.fast).toBeLessThanOrEqual(0.3)
    expect(MOTION_DURATION.base).toBeLessThanOrEqual(0.3)
    expect(MOTION_DURATION.slow).toBeLessThanOrEqual(0.3)
    expect(PAGE_MOTION_VARIANTS.animate.transition.duration).toBeLessThanOrEqual(0.3)
  })

  it('removes transforms and caps opacity transitions for reduced motion', () => {
    expect(REDUCED_PAGE_MOTION_VARIANTS.initial).not.toHaveProperty('y')
    expect(REDUCED_PAGE_MOTION_VARIANTS.animate).not.toHaveProperty('y')
    expect(REDUCED_REVEAL_MOTION_VARIANTS.hidden).not.toHaveProperty('y')
    expect(REDUCED_PAGE_MOTION_VARIANTS.animate.transition.duration).toBeLessThanOrEqual(0.08)
    expect(REDUCED_REVEAL_MOTION_VARIANTS.visible.transition.duration).toBeLessThanOrEqual(0.08)
  })

  it('caps staggered groups instead of delaying an unbounded list', () => {
    expect(MOTION_DURATION.marketing).toBeLessThanOrEqual(0.32)
    expect(MOTION_STAGGER.maximumItems).toBe(3)
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(2)).toBe(0.08)
    expect(staggerDelay(20)).toBe(0.08)
    expect(staggerDelay(20, 0.04, 99)).toBe(0.08)
  })
})
