export const MOTION_DURATION = Object.freeze({
  instant: 0,
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
  marketing: 0.32,
  reduced: 0.08,
})

export const MOTION_EASE = Object.freeze({
  standard: [0.2, 0, 0, 1],
  emphasized: [0.16, 1, 0.3, 1],
})

export const MOTION_SPRING = Object.freeze({
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.7,
})

export const MOTION_STAGGER = Object.freeze({
  reportItem: 0.04,
  marketingItem: 0.055,
  maximumItems: 3,
})

export const PAGE_MOTION_VARIANTS = Object.freeze({
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.base, ease: MOTION_EASE.standard },
  },
  exit: {
    opacity: 0,
    y: -2,
    transition: { duration: 0.09, ease: MOTION_EASE.standard },
  },
})

export const REDUCED_PAGE_MOTION_VARIANTS = Object.freeze({
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: MOTION_DURATION.reduced, ease: MOTION_EASE.standard },
  },
  exit: {
    opacity: 0,
    transition: { duration: MOTION_DURATION.reduced, ease: MOTION_EASE.standard },
  },
})

export const REVEAL_MOTION_VARIANTS = Object.freeze({
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: MOTION_EASE.emphasized },
  },
})

export const REDUCED_REVEAL_MOTION_VARIANTS = Object.freeze({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: MOTION_DURATION.reduced, ease: MOTION_EASE.standard },
  },
})

export function staggerDelay(index, interval = MOTION_STAGGER.reportItem, maximumItems = 3) {
  const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.trunc(Number(index))) : 0
  const safeMaximumItems = Math.min(
    MOTION_STAGGER.maximumItems,
    Math.max(1, Math.trunc(Number(maximumItems) || MOTION_STAGGER.maximumItems)),
  )
  const cappedIndex = Math.min(safeIndex, safeMaximumItems - 1)
  return Number((cappedIndex * interval).toFixed(3))
}
