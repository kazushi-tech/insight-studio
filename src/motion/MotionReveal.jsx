import * as Motion from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  MOTION_STAGGER,
  REDUCED_REVEAL_MOTION_VARIANTS,
  REVEAL_MOTION_VARIANTS,
  staggerDelay,
} from './tokens'

export default function MotionReveal({
  children,
  className,
  index = 0,
  maximumItems = 3,
  viewport,
  ...props
}) {
  const shouldReduceMotion = useReducedMotion()
  const delay = shouldReduceMotion ? 0 : staggerDelay(index, MOTION_STAGGER.reportItem, maximumItems)
  const variants = shouldReduceMotion
    ? REDUCED_REVEAL_MOTION_VARIANTS
    : {
        ...REVEAL_MOTION_VARIANTS,
        visible: {
          ...REVEAL_MOTION_VARIANTS.visible,
          transition: {
            ...REVEAL_MOTION_VARIANTS.visible.transition,
            delay,
          },
        },
      }

  return (
    <Motion.div
      initial="hidden"
      whileInView="visible"
      variants={variants}
      viewport={{ once: true, amount: 0.18, ...viewport }}
      className={className}
      {...props}
    >
      {children}
    </Motion.div>
  )
}
