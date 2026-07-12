import * as Motion from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  PAGE_MOTION_VARIANTS,
  REDUCED_PAGE_MOTION_VARIANTS,
} from './tokens'

export default function MotionPage({ children, className, ...props }) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <Motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={shouldReduceMotion ? REDUCED_PAGE_MOTION_VARIANTS : PAGE_MOTION_VARIANTS}
      className={className}
      {...props}
    >
      {children}
    </Motion.div>
  )
}
